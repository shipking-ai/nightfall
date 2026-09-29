#!/usr/bin/env python3
"""
Pack MakeHuman's bundled (CC0 1.0) human into compact binaries for the RPG.

  python3 tools/mh/convert.py /path/to/makehuman/makehuman/data public/rpg/mh

What it writes (all little-endian):
  mh.json  - the layout of mh.bin, target names, joint vertex groups, group ranges
  mh.bin   - base positions (metres), render vertices (position index + uv) and
             triangles per group, the chosen morph targets (sparse, int16 deltas),
             skin weights mapped onto the game's 16 bones, the eye proxy fit
  eye.jpg  - the iris texture

MakeHuman: http://www.makehumancommunity.org - assets CC0 1.0 (LICENSE.md, section C).
"""
import json, os, re, struct, sys, math
from collections import defaultdict

SRC = sys.argv[1] if len(sys.argv) > 1 else '/home/user/makehumancommunity/makehuman/makehuman/data'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/rpg/mh'
os.makedirs(OUT, exist_ok=True)
SCALE = 0.1  # MakeHuman units are decimetres

# ---------------------------------------------------------------- the base mesh
verts, uvs = [], []
groups = defaultdict(list)  # name -> list of faces [(vi, ti), ...]
g = None
for line in open(os.path.join(SRC, '3dobjs/base.obj')):
    if line.startswith('v '):
        x, y, z = map(float, line.split()[1:4])
        verts.append((x * SCALE, y * SCALE, z * SCALE))
    elif line.startswith('vt '):
        u, v = map(float, line.split()[1:3])
        uvs.append((u, v))
    elif line.startswith('g '):
        g = line.split()[1]
    elif line.startswith('f '):
        f = []
        for t in line.split()[1:]:
            p = t.split('/')
            f.append((int(p[0]) - 1, int(p[1]) - 1 if len(p) > 1 and p[1] else 0))
        groups[g].append(f)
NV = len(verts)
print('verts', NV, 'uvs', len(uvs))

RENDER = ['body', 'helper-tights', 'helper-skirt', 'helper-hair', 'helper-l-eyelashes-1', 'helper-l-eyelashes-2', 'helper-r-eyelashes-1', 'helper-r-eyelashes-2', 'helper-upper-teeth', 'helper-lower-teeth', 'helper-tongue']
rv_pos, rv_uv = [], []
rv_key = {}
group_tris = {}
for name in RENDER:
    tris = []
    for f in groups[name]:
        ids = []
        for (vi, ti) in f:
            k = (vi, ti)
            if k not in rv_key:
                rv_key[k] = len(rv_pos)
                rv_pos.append(vi)
                rv_uv.append(uvs[ti] if ti < len(uvs) else (0, 0))
            ids.append(rv_key[k])
        for i in range(1, len(ids) - 1):
            tris.append((ids[0], ids[i], ids[i + 1]))
    group_tris[name] = tris
    print(name, len(tris), 'tris')
NR = len(rv_pos)
print('render verts', NR)

# ---------------------------------------------------------------- targets
TD = os.path.join(SRC, 'targets')

def read_target(path):
    d = {}
    for line in open(path):
        if not line.strip() or line.startswith('#'):
            continue
        p = line.split()
        d[int(p[0])] = (float(p[1]) * SCALE, float(p[2]) * SCALE, float(p[3]) * SCALE)
    return d

targets = []  # (name, dict)
for race in ('african', 'asian', 'caucasian'):
    for sex in ('female', 'male'):
        for age in ('young', 'old'):
            targets.append((f'race/{race}-{sex}-{age}', read_target(f'{TD}/macrodetails/{race}-{sex}-{age}.target')))
for sex in ('female', 'male'):
    for age in ('young', 'old'):
        for mus in ('minmuscle', 'averagemuscle', 'maxmuscle'):
            for wt in ('minweight', 'averageweight', 'maxweight'):
                d = read_target(f'{TD}/macrodetails/universal-{sex}-{age}-{mus}-{wt}.target')
                if d:
                    targets.append((f'uni/{sex}-{age}-{mus}-{wt}', d))
# (height comes from the rig's own scale, not the height targets: they'd triple the download)

# detail targets: a curated set of faces and bodies; left/right pairs are merged (symmetric)
DETAIL = {
    'nose': ['nose-scale-horiz-incr', 'nose-scale-horiz-decr', 'nose-scale-vert-incr', 'nose-scale-vert-decr', 'nose-scale-depth-incr', 'nose-scale-depth-decr', 'nose-hump-incr', 'nose-hump-decr', 'nose-nostrils-width-incr', 'nose-nostrils-width-decr', 'nose-point-width-incr', 'nose-point-width-decr', 'nose-trans-up', 'nose-trans-down', 'nose-curve-convex', 'nose-curve-concave', 'nose-greek-incr', 'nose-width1-incr', 'nose-width1-decr'],
    'mouth': ['mouth-scale-horiz-incr', 'mouth-scale-horiz-decr', 'mouth-scale-vert-incr', 'mouth-scale-vert-decr', 'mouth-lowerlip-volume-incr', 'mouth-lowerlip-volume-decr', 'mouth-upperlip-volume-incr', 'mouth-upperlip-volume-decr', 'mouth-angles-up', 'mouth-angles-down', 'mouth-trans-forward', 'mouth-trans-backward', 'mouth-cupidsbow-incr', 'mouth-cupidsbow-decr'],
    'chin': ['chin-bones-incr', 'chin-bones-decr', 'chin-height-incr', 'chin-height-decr', 'chin-prominent-incr', 'chin-prominent-decr', 'chin-width-incr', 'chin-width-decr', 'chin-cleft-incr', 'chin-jaw-drop-incr'],
    'forehead': ['forehead-scale-vert-incr', 'forehead-scale-vert-decr', 'forehead-trans-forward', 'forehead-trans-backward', 'forehead-temple-incr', 'forehead-temple-decr'],
    'head': ['head-age-incr', 'head-age-decr', 'head-fat-incr', 'head-fat-decr', 'head-oval', 'head-round', 'head-rectangular', 'head-square', 'head-triangular', 'head-diamond', 'head-scale-horiz-incr', 'head-scale-horiz-decr', 'head-scale-vert-incr', 'head-scale-vert-decr'],
    'neck': ['neck-scale-horiz-incr', 'neck-scale-horiz-decr', 'neck-scale-depth-incr', 'neck-double-incr'],
    'eyebrows': ['eyebrows-trans-up', 'eyebrows-trans-down', 'eyebrows-trans-forward', 'eyebrows-angle-up', 'eyebrows-angle-down'],
    'torso': ['torso-muscle-pectoral-incr', 'torso-muscle-pectoral-decr', 'torso-muscle-dorsi-incr', 'torso-vshape-incr', 'torso-vshape-decr', 'torso-scale-horiz-incr', 'torso-scale-horiz-decr'],
    'stomach': ['stomach-pregnant-incr', 'stomach-pregnant-decr'],
    'hip': ['hip-scale-horiz-incr', 'hip-scale-horiz-decr'],
    'buttocks': ['buttocks-volume-incr', 'buttocks-volume-decr'],
}
PAIRED = {
    'eyes': ['eye-scale-incr', 'eye-scale-decr', 'eye-trans-up', 'eye-trans-down', 'eye-bag-incr', 'eye-bag-decr', 'eye-epicanthus-in', 'eye-epicanthus-out', 'eye-eyefold-angle-up', 'eye-eyefold-angle-down', 'eye-height2-incr', 'eye-height2-decr', 'eye-corner1-up', 'eye-corner1-down'],
    'cheek': ['cheek-bones-incr', 'cheek-bones-decr', 'cheek-volume-incr', 'cheek-volume-decr', 'cheek-inner-incr', 'cheek-inner-decr'],
    'ears': ['ear-scale-incr', 'ear-scale-decr', 'ear-lobe-incr', 'ear-flap-incr', 'ear-flap-decr', 'ear-rot-backward', 'ear-rot-forward'],
}
for folder, names in DETAIL.items():
    for n in names:
        p = f'{TD}/{folder}/{n}.target'
        if os.path.exists(p):
            targets.append((f'{folder}/{n}', read_target(p)))
        else:
            print('missing', p)
for folder, names in PAIRED.items():
    for n in names:
        d = {}
        for side in ('l', 'r'):
            p = f'{TD}/{folder}/{side}-{n}.target'
            if os.path.exists(p):
                for k, v in read_target(p).items():
                    d[k] = v
        if d:
            targets.append((f'{folder}/{n}', d))
        else:
            print('missing pair', folder, n)
print('targets', len(targets))

# ---------------------------------------------------------------- the skeleton, mapped onto the game's 16 bones
BONES = ['pelvis', 'spine', 'chest', 'neck', 'shL', 'elL', 'wrL', 'shR', 'elR', 'wrR', 'hipL', 'knL', 'anL', 'hipR', 'knR', 'anR']
BI = {b: i for i, b in enumerate(BONES)}
skel = json.load(open(os.path.join(SRC, 'rigs/default.mhskel')))
wts = json.load(open(os.path.join(SRC, 'rigs/default_weights.mhw')))['weights']
joints = skel['joints']

def joint_pos(name):
    ids = joints[name]
    x = sum(verts[i][0] for i in ids) / len(ids)
    return x

def side_of(bone):
    b = skel['bones'][bone]
    x = joint_pos(b['head'])
    # the game's figure faces +z with its right side at +x
    return 'R' if x > 0 else 'L'

def map_bone(b):
    n = b.lower()
    s = side_of(b) if ('.l' in n or '.r' in n) else None
    if n.startswith('root') or n.startswith('pelvis'):
        return 'pelvis'
    if n == 'spine05':
        return 'pelvis'
    if n in ('spine04', 'spine03'):
        return 'spine'
    if n in ('spine02', 'spine01') or n.startswith('breast') or n.startswith('clavicle'):
        return 'chest'
    if n.startswith('shoulder') or n.startswith('upperarm'):
        return 'sh' + s
    if n.startswith('lowerarm'):
        return 'el' + s
    if n.startswith(('wrist', 'metacarpal', 'finger', 'thumb')):
        return 'wr' + s
    if n.startswith('upperleg'):
        return 'hip' + s
    if n.startswith('lowerleg'):
        return 'kn' + s
    if n.startswith(('foot', 'toe')):
        return 'an' + s
    # neck, head, jaw, eyes, tongue, the face
    return 'neck'

per_vert = defaultdict(lambda: defaultdict(float))
unmapped = set()
for bone, lst in wts.items():
    if bone not in skel['bones']:
        unmapped.add(bone)
        continue
    ours = BI[map_bone(bone)]
    for vi, w in lst:
        per_vert[vi][ours] += w
print('unmapped weight bones', sorted(unmapped)[:10])

skin_idx = bytearray(NV * 4)
skin_w = []
for v in range(NV):
    d = per_vert.get(v)
    if not d:
        skin_idx[v * 4] = 0
        skin_w.append((1.0, 0, 0, 0))
        continue
    top = sorted(d.items(), key=lambda kv: -kv[1])[:4]
    s = sum(w for _, w in top) or 1
    ws = [0.0] * 4
    for k, (b, w) in enumerate(top):
        skin_idx[v * 4 + k] = b
        ws[k] = w / s
    skin_w.append(tuple(ws))

# joints the game needs (MakeHuman joint vertex groups), by our names; side by position
def bone_joint(bone, end):
    return skel['bones'][bone][end]

def find(prefix, side, end):
    for name in skel['bones']:
        if name.lower().startswith(prefix) and (side is None or side_of(name) == side):
            return bone_joint(name, end)
    raise KeyError(prefix)

J = {
    'pelvis': find('spine05', None, 'head'),
    'chest': find('spine02', None, 'head'),
    'neck': find('neck01', None, 'head'),
    'head': find('head', None, 'head'),
    'headTop': find('head', None, 'tail'),
}
for s in ('L', 'R'):
    J['sh' + s] = find('upperarm01', s, 'head')
    J['el' + s] = find('lowerarm01', s, 'head')
    J['wr' + s] = find('wrist', s, 'head')
    J['hand' + s] = find('finger3-1', s, 'head')
    J['hip' + s] = find('upperleg01', s, 'head')
    J['kn' + s] = find('lowerleg01', s, 'head')
    J['an' + s] = find('foot', s, 'head')
    J['toe' + s] = find('foot', s, 'tail')
    J['eye' + s] = find('eye', s, 'head')
joint_groups = {k: joints[v] for k, v in J.items()}

# ---------------------------------------------------------------- the eye proxy (fitted to the base mesh)
def read_obj(path):
    vs, ts, fs = [], [], []
    for line in open(path):
        if line.startswith('v '):
            vs.append(tuple(float(x) * SCALE for x in line.split()[1:4]))
        elif line.startswith('vt '):
            ts.append(tuple(map(float, line.split()[1:3])))
        elif line.startswith('f '):
            f = []
            for t in line.split()[1:]:
                p = t.split('/')
                f.append((int(p[0]) - 1, int(p[1]) - 1 if len(p) > 1 and p[1] else 0))
            fs.append(f)
    return vs, ts, fs

ev, et, ef = read_obj(os.path.join(SRC, 'eyes/high-poly/high-poly.obj'))
fit = []
mode = None
scales = {}
for line in open(os.path.join(SRC, 'eyes/high-poly/high-poly.mhclo')):
    p = line.split()
    if not p or p[0].startswith('#'):
        continue
    if p[0] in ('x_scale', 'y_scale', 'z_scale'):
        scales[p[0][0]] = (int(p[1]), int(p[2]), float(p[3]))
    elif p[0] == 'verts':
        mode = 'verts'
        continue
    elif p[0] in ('weights', 'delete_verts'):
        mode = None
    elif mode == 'verts':
        if len(p) == 9:
            fit.append((int(p[0]), int(p[1]), int(p[2]), float(p[3]), float(p[4]), float(p[5]), float(p[6]), float(p[7]), float(p[8])))
        elif len(p) == 1:
            fit.append((int(p[0]), 0, 0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0))
print('eye verts', len(ev), 'fit', len(fit))
eye_key, eye_pos, eye_uv, eye_tris = {}, [], [], []
for f in ef:
    ids = []
    for (vi, ti) in f:
        k = (vi, ti)
        if k not in eye_key:
            eye_key[k] = len(eye_pos)
            eye_pos.append(vi)
            eye_uv.append(et[ti] if ti < len(et) else (0, 0))
        ids.append(eye_key[k])
    for i in range(1, len(ids) - 1):
        eye_tris.append((ids[0], ids[i], ids[i + 1]))

# ---------------------------------------------------------------- write
blob = bytearray()
layout = {}

def put(name, fmt, data):
    while len(blob) % 4:
        blob.append(0)
    off = len(blob)
    blob.extend(struct.pack('<' + fmt * len(data), *data) if fmt else data)
    layout[name] = {'offset': off, 'count': len(data)}

put('base', 'f', [c for v in verts for c in v])
put('rvPos', 'I', rv_pos)
put('rvUv', 'f', [c for uv in rv_uv for c in uv])
for name in RENDER:
    put('tris:' + name, 'I', [i for t in group_tris[name] for i in t])
put('skinIndex', '', bytes(skin_idx))
put('skinWeight', 'f', [c for w in skin_w for c in w])
tmeta = []
QT = 2e-5
for name, d in targets:
    items = sorted(d.items())
    idx = [k for k, _ in items]
    q = []
    for _, (x, y, z) in items:
        for c in (x, y, z):
            q.append(max(-32767, min(32767, int(round(c / QT)))))
    put('ti:' + name, 'H', idx)
    put('td:' + name, 'h', q)
    tmeta.append(name)
put('eyeFit', 'f', [c for r in fit for c in r])
put('eyePos', 'I', eye_pos)
put('eyeUv', 'f', [c for uv in eye_uv for c in uv])
put('eyeTris', 'I', [i for t in eye_tris for i in t])
# the eye proxy's own vertices (for the fit's offsets it's the rest positions that matter; kept for reference)
put('eyeRest', 'f', [c for v in ev for c in v])

open(os.path.join(OUT, 'mh.bin'), 'wb').write(blob)
meta = {
    'source': 'MakeHuman 1.x bundled assets, CC0 1.0 (http://www.makehumancommunity.org)',
    'scale': SCALE, 'nv': NV, 'nr': NR, 'qt': QT, 'groups': RENDER, 'targets': tmeta, 'layout': layout,
    'joints': joint_groups, 'eyeScales': scales, 'bones': BONES,
}
json.dump(meta, open(os.path.join(OUT, 'mh.json'), 'w'))
print('mh.bin', round(len(blob) / 1e6, 2), 'MB')

# the iris texture
try:
    from PIL import Image
    im = Image.open(os.path.join(SRC, 'eyes/materials/brown_eye.png')).convert('RGB')
    im.thumbnail((512, 512))
    im.save(os.path.join(OUT, 'eye.jpg'), quality=88)
except Exception as e:
    import shutil
    shutil.copy(os.path.join(SRC, 'eyes/materials/brown_eye.png'), os.path.join(OUT, 'eye.png'))
    print('eye texture copied as png', e)
