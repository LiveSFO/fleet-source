"""Create a derived registration map; retain upstream bytes unchanged."""
from pathlib import Path
from PIL import Image,ImageFont,ImageDraw
import numpy as np,json,sys
BASE=Path(__file__).resolve().parents[1]/'assets/airliners'
source=BASE/'preparation/737-Next-Generation/upstream/Models/Liveries-800/UAL-2019.png';registration=sys.argv[1] if len(sys.argv)>1 else 'N77259'
im=Image.open(source).convert('RGB');a=np.asarray(im);h,w=a.shape[:2];patches=[]
for xa,xb,ya,yb in [(.25,.31,.015,.04),(.70,.78,.12,.15)]:
 x0,x1,y0,y1=int(xa*w),int(xb*w),int(ya*h),int(yb*h);crop=a[y0:y1,x0:x1].astype(np.int16);mask=(crop.max(2)<80)&(crop.max(2)-crop.min(2)<25);ys,xs=np.nonzero(mask)
 if not len(xs):raise ValueError('Registration glyphs not found in reviewed source region')
 box=[int(xs.min()+x0),int(ys.min()+y0),int(xs.max()+x0),int(ys.max()+y0)];draw=ImageDraw.Draw(im);draw.rectangle([box[0]-1,box[1]-1,box[2]+1,box[3]+1],fill='white')
 font_path=Path('/System/Library/Fonts/Supplemental/Arial Bold.ttf');font=ImageFont.truetype(str(font_path),14);text_box=font.getbbox(registration);draw.text((box[0],box[1]-text_box[1]),registration,font=font,fill='black');patches.append(box)
out=BASE/'b38m/generated/registration';out.mkdir(parents=True,exist_ok=True);path=out/(registration+'.png');im.save(path);(out/(registration+'.json')).write_text(json.dumps({'source':str(source.relative_to(BASE)),'registration':registration,'regions':patches,'evidence':'traffic/fr24-arrivals-props.json: UA1969, and departures: UA2623; B38M N77259 in captured Nov 11 board.','font':'Arial Bold, rasterized only'},indent=2));print(path)
