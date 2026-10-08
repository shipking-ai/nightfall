"""
Pack the CC0 textures the RPG's people use, from MakeHuman and MPFB2:

  public/rpg/mh/eye.png      the MakeHuman eyeball (photographic sclera with
                             veins, a fibrous iris): RGB with the iris turned
                             to grey so any eye colour can tint it, alpha =
                             the iris mask
  public/rpg/mh/regions.png  MPFB2's region masks, in MakeHuman's body UVs:
                             R lips, G eyelids, B finger- and toenails,
                             A subsurface thickness (MPFB2 sss.png)

Sources (both CC0 1.0):
  makehuman/data/eyes/materials/brown_eye.png   (makehumancommunity/makehuman)
  mpfb/data/textures/*.jpg, sss.png              (makehumancommunity/mpfb2)
"""
import os
import sys
from PIL import Image, ImageFilter, ImageOps

MH = sys.argv[1] if len(sys.argv) > 1 else '/home/user/makehumancommunity/makehuman/makehuman/data'
MPFB = sys.argv[2] if len(sys.argv) > 2 else '/home/user/makehumancommunity/mpfb2/src/mpfb/data'
OUT = os.path.join(os.path.dirname(__file__), '../../public/rpg/mh')

# ── the eye ─────────────────────────────────────────────
eye = Image.open(os.path.join(MH, 'eyes/materials/brown_eye.png')).convert('RGB').resize((512, 512), Image.LANCZOS)
W, H = eye.size
px = eye.load()
# the pupils: the darkest blobs; find each one's centre (the texture holds two eyeballs)
dark = [(x, y) for y in range(H) for x in range(W) if sum(px[x, y]) < 90]
dark.sort(key=lambda p: p[0] + p[1])
clusters = []
for p in dark:
    for c in clusters:
        if abs(c[0] / c[2] - p[0]) < 110 and abs(c[1] / c[2] - p[1]) < 110:
            c[0] += p[0]; c[1] += p[1]; c[2] += 1
            break
    else:
        clusters.append([p[0], p[1], 1])
clusters = sorted(clusters, key=lambda c: -c[2])[:2]
centres = [(c[0] / c[2], c[1] / c[2]) for c in clusters]
print('pupils at', [(round(x), round(y)) for x, y in centres])
# the iris radius: walk out from the centre until the colour turns to sclera (bright, low saturation)
def sat(c):
    mx, mn = max(c), min(c)
    return 0 if mx == 0 else (mx - mn) / mx
radii = []
for cx, cy in centres:
    rs = []
    for a in range(0, 360, 15):
        import math
        for r in range(4, 120):
            x, y = int(cx + math.cos(math.radians(a)) * r), int(cy + math.sin(math.radians(a)) * r)
            if not (0 <= x < W and 0 <= y < H):
                break
            c = px[x, y]
            if sum(c) / 3 > 150 and sat(c) < 0.3:
                rs.append(r)
                break
    rs.sort()
    radii.append(rs[len(rs) // 2] if rs else 50)
print('iris radii', radii)
out = Image.new('RGBA', (W, H))
op = out.load()
import math
for y in range(H):
    for x in range(W):
        r, g, b = px[x, y]
        m = 0.0
        for (cx, cy), R in zip(centres, radii):
            d = math.hypot(x - cx, y - cy)
            m = max(m, min(1.0, max(0.0, (R - 3 - d) / 3.0)))
        lum = int(0.3 * r + 0.55 * g + 0.15 * b)
        # the iris goes to grey (the shader tints it); lift it so a tint has something to work with
        if m > 0:
            gl = min(235, int(lum * 1.7))
            r, g, b = [int(v * (1 - m) + gl * m) for v in (r, g, b)]
        op[x, y] = (r, g, b, int(m * 255))
out.save(os.path.join(OUT, 'eye.png'), optimize=True)

# ── the skin regions ────────────────────────────────────
S = 512
def mask(name):
    return Image.open(os.path.join(MPFB, 'textures', f'mpfb_{name}.jpg')).convert('L').resize((S, S), Image.LANCZOS)
lips = mask('lips').filter(ImageFilter.GaussianBlur(1))
lids = mask('eyelids').filter(ImageFilter.GaussianBlur(1.5))
fn, tn = mask('fingernails'), mask('toenails')
nails = Image.new('L', (S, S))
nl, f1, t1 = nails.load(), fn.load(), tn.load()
for y in range(S):
    for x in range(S):
        nl[x, y] = max(f1[x, y], t1[x, y])
sss = Image.open(os.path.join(MPFB, 'textures', 'sss.png')).convert('L').resize((S, S), Image.LANCZOS)
sss = ImageOps.autocontrast(sss, cutoff=1)
Image.merge('RGBA', (lips, lids, nails, sss)).save(os.path.join(OUT, 'regions.png'), optimize=True)
for f in ('eye.png', 'regions.png'):
    print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
