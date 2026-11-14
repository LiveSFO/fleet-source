"""Remove reviewed legacy window decals before transfer to real 3D glazing.
The source artwork is preserved; derived pixels use vertical skin interpolation.
"""
from pathlib import Path
import json,sys,hashlib
import numpy as np
from PIL import Image
from generate_fleet_cabin_masks import components
BASE=Path(__file__).resolve().parents[1]/'assets/airliners'
def strip(source,reference,out,rows,small=False):
 im=Image.open(BASE/source).convert('RGB');a=np.asarray(im).copy();ref=Image.open(BASE/reference).convert('RGB').resize(im.size);r=np.asarray(ref).astype(int);h,w=a.shape[:2]
 dark=(r.max(2)<185)&(r.max(2)-r.min(2)<65)
 boxes=[b for b in components(dark) if (.0007 if small else .002)*w<b[2]-b[0]+1<.012*w and (.0015 if small else .003)*h<b[3]-b[1]+1<.025*h and .3<(b[2]-b[0]+1)/(b[3]-b[1]+1)<1.1 and any(abs((b[1]+b[3])/2/h-row)<.006 for row in rows)]
 for x0,y0,x1,y1,area in boxes:
  x0=max(0,x0-4);x1=min(w-1,x1+4);y0=max(1,y0-4);y1=min(h-2,y1+4)
  above=a[y0-1,x0:x1+1].astype(float);below=a[y1+1,x0:x1+1].astype(float)
  for y in range(y0,y1+1):
   t=(y-y0+1)/(y1-y0+2);a[y,x0:x1+1]=np.uint8(above*(1-t)+below*t)
 path=BASE/out;path.parent.mkdir(parents=True,exist_ok=True);Image.fromarray(a).save(path)
 path.with_suffix('.json').write_text(json.dumps({'source':source,'reference':reference,'removedWindowRegions':boxes,'method':'Only portrait decal components in reviewed legacy window rows; skin interpolated vertically. No source geometry or original images altered.','sourceSHA256':hashlib.sha256((BASE/source).read_bytes()).hexdigest()},indent=2)+'\n')
 print(out,len(boxes))
if __name__=='__main__':
 for paint in ['JAL','ANZ']:
  strip('preparation/787-9/upstream/Models/Liveries/'+paint+'.png','preparation/787-9/upstream/Models/Liveries/JAL.png','b789-current/generated/clean-donors/'+paint+'.png',[.184,.443])
