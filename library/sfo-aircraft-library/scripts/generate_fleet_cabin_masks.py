"""Find repeated painted window rows; emit UV masks for manual visual review."""
from pathlib import Path
import json,numpy as np
from PIL import Image,ImageDraw
BASE=Path(__file__).resolve().parents[1]/'assets/airliners'
REFERENCES={
 'a319':'preparation/A320Family-modern/upstream/Models/Liveries/A319/CFM/DAL.png',
 'a320':'preparation/A320Family-modern/upstream/Models/Liveries/A320/CFM/DAL.png',
 'a321':'preparation/naviat-liveries/upstream/A320 family/A321/CFM/DAL.png',
 'a21n':'preparation/naviat-liveries/upstream/A320 family/A321/CFM-NEO/AAL.png',
 'a332':'preparation/IDG-A33X/upstream/Models/Liveries/A332RR/HAL.png',
 'b39m':'preparation/737-MAX/upstream/Models/737-9.png',
 'b763':'preparation/767-300-modern/upstream/Models/DAL.png',
}
def components(mask):
 parents=[];boxes=[];last=[]
 def find(i):
  while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
  return i
 for y,row in enumerate(mask):
  edges=np.flatnonzero(np.diff(np.r_[False,row,False]));current=[]
  for x0,x1 in zip(edges[::2],edges[1::2]):
   i=len(parents);parents.append(i);boxes.append([int(x0),y,int(x1-1),y,int(x1-x0)])
   for a,b,j in last:
    if b<x0-1:continue
    if a>x1:break
    parents[find(j)]=find(i)
   current.append((x0,x1,i))
  last=current
 result={}
 for i,box in enumerate(boxes):
  root=find(i)
  if root not in result:result[root]=box.copy()
  else:
   a=result[root];a[0]=min(a[0],box[0]);a[1]=min(a[1],box[1]);a[2]=max(a[2],box[2]);a[3]=max(a[3],box[3]);a[4]+=box[4]
 return list(result.values())
def main():
 for key,ref in REFERENCES.items():
  path=BASE/ref
  if not path.exists():print(key,'MISSING',ref);continue
  im=Image.open(path).convert('RGB');a=np.asarray(im).astype(np.int16);h,w=a.shape[:2]
  dark=(a.max(2)<220)&(a.max(2)-a.min(2)<42)
  raw=components(dark)
  shapes=[b for b in raw if .0015*w<b[2]-b[0]+1<.022*w and .003*h<b[3]-b[1]+1<.04*h and .3<(b[2]-b[0]+1)/(b[3]-b[1]+1)<1.3 and b[4]>.25*(b[2]-b[0]+1)*(b[3]-b[1]+1)]
  rows=[]
  for box in sorted(shapes,key=lambda b:(b[1]+b[3])/2):
   cy=(box[1]+box[3])/2
   row=next((r for r in rows if abs(r['cy']-cy)<.004*h),None)
   if row is None:row={'cy':cy,'boxes':[]};rows.append(row)
   row['boxes'].append(box)
  rows=[r for r in rows if len(r['boxes'])>=12 and max(b[2] for b in r['boxes'])-min(b[0] for b in r['boxes'])>.3*w]
  selected=[]
  for row in rows:
   median=np.median([b[3]-b[1]+1 for b in row['boxes']]);selected += [b for b in row['boxes'] if .45*median<b[3]-b[1]+1<1.6*median]
  door_regions=[]
  for row in rows:
   median=float(np.median([b[3]-b[1]+1 for b in row['boxes']]));left=min(b[0] for b in row['boxes']);right=max(b[2] for b in row['boxes'])
   for b in shapes:
    width,height=b[2]-b[0]+1,b[3]-b[1]+1;cx,cy=(b[0]+b[2])/2,(b[1]+b[3])/2
    if b in selected:continue
    if .2*median<height<1.15*median and .65<width/height<1.4 and median*.65<abs(cy-row['cy'])<median*3 and left-.08*w<cx<right+.08*w:door_regions.append(b)
  # Automatic candidates are diagnostics, not accepted door windows.
  if key=='b39m':
   door_regions=[]
   for cx,cy in [(.17875,.05125),(.8587,.0484),(.1387,.199),(.81875,.2025)]:
    x0,y0=int((cx-.012)*w),int((cy-.012)*h);x1,y1=int((cx+.012)*w),int((cy+.012)*h)
    patch=dark[y0:y1,x0:x1];candidates=[]
    for box in components(patch):
     bw,bh=box[2]-box[0]+1,box[3]-box[1]+1
     if .002*w<bw<.008*w and .75<bw/bh<1.33 and box[0]>0 and box[1]>0 and box[2]<patch.shape[1]-1 and box[3]<patch.shape[0]-1:
      candidates.append(box)
    assert candidates,'No round door viewing window found in reviewed source region'
    box=min(candidates,key=lambda b:((b[0]+b[2])/2-patch.shape[1]/2)**2+((b[1]+b[3])/2-patch.shape[0]/2)**2)
    door_regions.append([box[0]+x0,box[1]+y0,box[2]+x0,box[3]+y0,box[4]])
   assert len(door_regions)==4
   selected += door_regions
  mask=Image.new('RGB',(w,h));draw=ImageDraw.Draw(mask);review=im.copy();rd=ImageDraw.Draw(review)
  for x0,y0,x1,y1,area in selected:
   inset=max(1,round(min(x1-x0,y1-y0)*.08));draw.rounded_rectangle((x0+inset,y0+inset,x1-inset,y1-inset),radius=max(1,(x1-x0)*.3),fill='white');rd.rectangle((x0-2,y0-2,x1+2,y1+2),outline='#ff00ff',width=max(1,w//1000))
  out=BASE/key/'generated';out.mkdir(parents=True,exist_ok=True);mask.save(out/'cabin-window-mask.png');review.thumbnail((1200,1200));review.save(out/'cabin-mask-review.png')
  (out/'cabin-mask.json').write_text(json.dumps({'reference':ref,'size':[w,h],'detectedRows':len(rows),'regions':selected,'doorCandidates':door_regions,'status':'requires-visual-review'},indent=2));print(key,len(rows),len(selected),flush=True)

if __name__=='__main__':main()
