"""Generate a UV-aligned cabin emission mask from the paintkit's window layout."""
from PIL import Image,ImageDraw
import pathlib,json
base=pathlib.Path(__file__).resolve().parents[1]/'assets/airliners'
p=base/'a320neo/upstream/Models/Liveries/CFM-NEO/4k/BAW-fuselage.png'
im=Image.open(p).convert('RGB');w,h=im.size;px=im.load();candidate=set()
for ya,yb in [(.085,.104),(.328,.347)]:
 for y in range(int(h*ya),int(h*yb)):
  for x in range(int(w*.12),int(w*.80)):
   c=px[x,y]
   if max(c)-min(c)<32 and 35<sum(c)/3<185:candidate.add((x,y))
boxes=[]
while candidate:
 seed=candidate.pop();stack=[seed];pts=[seed]
 while stack:
  x,y=stack.pop()
  for q in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
   if q in candidate:candidate.remove(q);stack.append(q);pts.append(q)
 xs=[p[0] for p in pts];ys=[p[1] for p in pts];a,b,c,d=min(xs),min(ys),max(xs),max(ys)
 if 8<c-a<45 and 12<d-b<50 and .4<(c-a)/(d-b)<1.3 and len(pts)>100:boxes.append([a,b,c,d])
boxes.sort()
door_boxes=[box for box in boxes if box[0]<w*.14 or box[0]>w*.745]
assert len(door_boxes)==4,'Expected four passenger-door peepholes in this pinned paint layout'
out=base/'a320neo/generated';out.mkdir(exist_ok=True)
mask=Image.new('RGB',(w,h));draw=ImageDraw.Draw(mask)
for a,b,c,d in boxes:draw.rounded_rectangle([a+2,b+2,c-2,d-2],radius=5,fill=(255,255,255))
mask.save(out/'cabin-window-emission.png');(out/'window-mask.json').write_text(json.dumps({'windowRegions':len(boxes),'regions':boxes,'passengerDoorWindows':door_boxes},indent=2))
print('Window regions:',len(boxes))
