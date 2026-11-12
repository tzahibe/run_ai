#!/usr/bin/env python3
"""Turn a generated character image into a game-ready sprite.

    python3 tools/sprite.py <source.png> <id> [height]

Trims to the drawing, scales to a common height so every racer matches on the
track, and palette-quantises -- flat cel art loses nothing and gets ~85%
smaller. Writes client/sprites/<id>.png and prints a data: URI for the
single-file build.
"""
import sys, io, base64
from pathlib import Path
from PIL import Image
import numpy as np

src, cid = sys.argv[1], sys.argv[2]
H = int(sys.argv[3]) if len(sys.argv) > 3 else 360

im = Image.open(src).convert('RGBA')
a = np.asarray(im)
if a[:, :, 3].max() < 250:
    sys.exit('error: this image has no opaque pixels — is it really a PNG with alpha?')
ys, xs = np.where(a[:, :, 3] > 16)
if not len(ys):
    sys.exit('error: the image is entirely transparent')
im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
w0, h0 = im.size
im = im.resize((max(1, round(w0 * H / h0)), H), Image.LANCZOS)

rgba = np.asarray(im)
hard = np.dstack([rgba[:, :, :3], np.where(rgba[:, :, 3] > 128, 255, 0).astype('uint8')])
out = Image.fromarray(hard, 'RGBA').quantize(colors=128, method=Image.FASTOCTREE)

dest = Path(__file__).resolve().parent.parent / 'client' / 'sprites' / f'{cid}.png'
dest.parent.mkdir(parents=True, exist_ok=True)
out.save(dest, optimize=True)

buf = io.BytesIO(); out.save(buf, 'PNG', optimize=True)
raw = buf.getvalue()
Path(f'/tmp/{cid}.b64').write_text('data:image/png;base64,' + base64.b64encode(raw).decode())
print(f'{cid}: source {w0}x{h0} -> {im.size[0]}x{im.size[1]}, {len(raw)/1024:.1f} KB')
print(f'  file      {dest}')
print(f'  data URI  /tmp/{cid}.b64')
