"""Lay out all eight current review views; never assign visual acceptance."""
from pathlib import Path
import hashlib,json,math
from PIL import Image,ImageDraw,ImageFont

BASE=Path(__file__).resolve().parents[1]/'assets/airliners'
FOLDER=BASE/'previews/detail-pass'
records=json.loads((FOLDER/'render-manifest.json').read_text())
rows=json.loads((BASE/'sfo-build-coverage.json').read_text())['combinations']
selectors=sorted({r['asset']['aircraft']+'/'+r['asset']['livery'] for r in rows})
views=['overview','starboard','front','rear','plan','mechanisms','stowed','cabin']
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',17)
index={};pages=0
for page in range(math.ceil(len(selectors)/4)):
    batch=selectors[page*4:(page+1)*4]
    ready=True
    for selector in batch:
        family,livery=selector.split('/')
        sha=hashlib.sha256((BASE/family/'exports'/f'{livery}.glb').read_bytes()).hexdigest()
        if not all(records.get(selector+'/'+v,{}).get('sha256')==sha for v in views):ready=False
    if not ready:continue
    sheet=Image.new('RGB',(1920,2304),'#e6e9ee');draw=ImageDraw.Draw(sheet)
    filename=f'fleet-detail-{page+1:02d}.jpg'
    for row,selector in enumerate(batch):
        for column,view in enumerate(views):
            record=records[selector+'/'+view]
            frame=Image.open(BASE/record['image']).convert('RGB')
            frame.thumbnail((472,260))
            x=(column%4)*480;y=row*576+(column//4)*288
            sheet.paste(frame,(x+(480-frame.width)//2,y+2))
            draw.text((x+7,y+264),selector+' · '+view,fill='#142035',font=font)
        index[selector]={'sha256':record['sha256'],
                         'sheet':str((FOLDER/filename).relative_to(BASE)),
                         'row':row+1,
                         'views':{v:records[selector+'/'+v] for v in views}}
    sheet.save(FOLDER/filename,quality=94,subsampling=0)
    pages+=1
(FOLDER/'sheet-index.json').write_text(json.dumps(index,indent=2)+'\n')
print(pages,'ready detail sheets;',len(index),'current assets represented')
