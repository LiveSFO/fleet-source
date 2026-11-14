"""Replace source paintkit primary RGB fills with the Heart brand palette.
Preserves grayscale markings and anti-aliased artwork; no geometry/UV changes.
"""
from PIL import Image
import numpy as np,pathlib,json
base=pathlib.Path(__file__).resolve().parents[1]/'assets/airliners/b738'
p=base/'upstream/Models/Liveries-800/SWA-new.png';im=Image.open(p).convert('RGBA');a=np.array(im);rgb=a[:,:,:3].astype(float)/255;out=rgb.copy()
colors={'blue':[48,76,178],'red':[213,21,46],'yellow':[255,191,39]};r,g,b=[rgb[:,:,i] for i in range(3)]
for name,mask,base_level,strength in [
 ('blue',(b>r+.05)&(b>g+.05),np.minimum(r,g),b-np.minimum(r,g)),
 ('red',(r>g+.05)&(r>b+.05),np.minimum(g,b),r-np.minimum(g,b)),
 ('yellow',(r>b+.1)&(g>b+.1)&(np.abs(r-g)<.08),b,np.minimum(r,g)-b),
]:
 col=np.array(colors[name])/255
 mapped=base_level[:,:,None]+strength[:,:,None]*col
 out[mask]=mapped[mask]
a[:,:,:3]=np.clip(np.rint(out*255),0,255).astype(np.uint8)
dest=base/'generated';dest.mkdir(exist_ok=True);Image.fromarray(a).save(dest/'SWA-heart-corrected.png')
(dest/'palette.json').write_text(json.dumps({'paletteRGB':colors,'basis':'Southwest Airlines Brand Style Guide, digital/illustration palette; visual paint approximation','reference':'https://relayto.com/explore/southwest-airlines-brand-book-oencohq6wqro8','sourceImage':'Models/Liveries-800/SWA-new.png','changes':'Replace saturated primary RGB paint fills; preserve lettering, layout, UVs, grayscale and source attribution.'},indent=2))
print('Saved Heart palette refinement')
