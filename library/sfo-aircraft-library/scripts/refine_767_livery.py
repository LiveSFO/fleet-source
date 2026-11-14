"""Retain exact-mesh licensed paint, darkening reviewed passenger-pane interiors.

The source atlas and reviewed mask share the same UV window stations. Preserve
the frame, panel lines, markings and unmodified upstream image for attribution.
"""
from pathlib import Path
import hashlib, json
import numpy as np
from PIL import Image

BASE=Path(__file__).resolve().parents[1]/'assets/airliners'
source=BASE/'preparation/naviat-liveries/upstream/767/UAL7.png'
maskpath=BASE/'b763/generated/cabin-window-mask.png'
image=Image.open(source).convert('RGB')
mask=Image.open(maskpath).convert('L').resize(image.size,Image.Resampling.NEAREST)
pixels=np.asarray(image).astype(float)
alpha=np.asarray(mask).astype(float)[:,:,None]/255
pixels=pixels*(1-alpha)+np.array([17,29,38])*alpha
out=BASE/'b763/generated/united/UAL7-smoked.png'
out.parent.mkdir(parents=True,exist_ok=True)
Image.fromarray(np.uint8(np.clip(pixels,0,255))).save(out)
out.with_suffix('.asset.json').write_text(json.dumps({
 'source':str(source.relative_to(BASE)),
 'sourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),
 'mask':str(maskpath.relative_to(BASE)),
 'change':'Darken reviewed window interiors to sRGB 17/29/38. Native paint proportions, panel details, frame outlines and N656UA registration retained.',
 'license':'GPL-2.0; source repaint by naviat-dev/FG-Liveries. Preserve upstream LICENSE, README and corresponding source.'
},indent=2)+'\n')
print(out)
