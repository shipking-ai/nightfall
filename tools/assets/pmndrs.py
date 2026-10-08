"""
Unpack the CC0 assets the RPG uses from @pmndrs/assets (npm; CC0 1.0):
Poly Haven HDRIs (512x512 EXR) and emmelleppi's normal maps (512x512 WebP).
Run: npm pack @pmndrs/assets && tar xzf pmndrs-assets-*.tgz, then
python3 tools/assets/pmndrs.py /path/to/package
"""
import base64, os, re, sys
PKG = sys.argv[1] if len(sys.argv) > 1 else '/tmp/pa/package'
OUT = os.path.join(os.path.dirname(__file__), '../../public/rpg')
HDRI = ['sky', 'park', 'forest', 'city', 'sunset', 'sunrise', 'dawn', 'night']
# normal maps by what they are (indices into the package's normals/)
NORMALS = {'pores': 27, 'weave': 21, 'knit': 15, 'leather': 3, 'crumple': 14, 'rock': 26, 'cliff': 5, 'cracked': 24, 'grit': 20, 'bark': 1}
def unpack(src, dst):
    t = open(src).read()
    m = re.search(r'base64,([A-Za-z0-9+/=]+)', t)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'wb').write(base64.b64decode(m.group(1)))
    print(dst, os.path.getsize(dst) // 1024, 'KB')
for h in HDRI:
    unpack(f'{PKG}/hdri/{h}.exr.js', f'{OUT}/env/{h}.exr')
for name, i in NORMALS.items():
    unpack(f'{PKG}/normals/{i:04d}.webp.js', f'{OUT}/tex/n_{name}.webp')
open(f'{OUT}/env/LICENSE.txt', 'w').write('HDR environments from Poly Haven (polyhaven.com), CC0 1.0, via @pmndrs/assets (CC0 1.0).\n')
open(f'{OUT}/tex/LICENSE.txt', 'w').write('Normal maps from emmelleppi/normal-maps via @pmndrs/assets, CC0 1.0.\n')
