"""Adapt the licensed A380 paint atlas to A6-EVN and mark both cabin decks."""
from pathlib import Path
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from generate_fleet_cabin_masks import components

BASE = Path(__file__).resolve().parents[1] / 'assets' / 'airliners'
SOURCE = BASE / 'preparation/A380-omega/upstream/Models/Liveries/A6-EDA.png'
OUTPUT = BASE / 'a388/generated'

# Coordinates follow the source atlas's four horizontal window rows.
ROWS = [(480,1520,382,399), (514,1643,455,472), (539,1575,802,818), (419,1550,874,891)]
DOORS = [
    (586,388),(810,388),(1298,388),(475,458),(697,458),(1003,458),(1413,458),(1667,458),
    (761,807),(1246,807),(1471,807),(394,877),(645,877),(1055,877),(1358,877),(1580,877),
]
EXPO_PATCHES = [(1583,383,1641,455),(1587,474,1645,507),(411,800,464,875),(417,895,463,929)]
OLD_REGISTRATIONS = [(391,480,439,497),(1617,897,1666,915)]


def fill_from_edges(image, box):
    x0, y0, x1, y1 = box
    t = np.linspace(0, 1, x1-x0)[None,:,None]
    left = np.median(image[y0:y1,x0-4:x0,:3], axis=1)
    right = np.median(image[y0:y1,x1:x1+4,:3], axis=1)
    image[y0:y1,x0:x1,:3] = np.rint((1-t)*left[:,None,:]+t*right[:,None,:])


def window_centers(paint, box):
    x0,x1,y0,y1 = box
    patch = paint[y0:y1,x0:x1,:3].astype(np.int16)
    # On the beige title and red swoosh the same panes are still desaturated.
    blue = (patch[:,:,2] >= patch[:,:,0]-2) & (patch.max(2)<197) & (np.ptp(patch,axis=2)<65)
    for left,top,right,bottom,area in components(blue):
        w,h=right-left+1,bottom-top+1
        if 4<=w<=11 and 6<=h<=15 and area>=w*h*.46:
            yield x0+(left+right)/2, y0+(top+bottom)/2, w, h


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    source=Image.open(SOURCE).convert('RGBA')
    paint=np.array(source)
    for box in EXPO_PATCHES + OLD_REGISTRATIONS:
        fill_from_edges(paint,box)
    # Keep the same A380 source layout and classic UAE fin. A6-EVN is the
    # Trent-powered airframe recorded for EK225 in the dated flight history.
    finish=Image.fromarray(paint)
    draw=ImageDraw.Draw(finish)
    font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',11)
    draw.text((394,481),'A6-EVN',font=font,fill='#262625')
    draw.text((1621,898),'A6-EVN',font=font,fill='#262625')
    finish.save(OUTPUT/'A6-EVN.png')
    mask=Image.new('RGB',source.size)
    draw=ImageDraw.Draw(mask)
    review=finish.copy()
    proof=ImageDraw.Draw(review)
    counts=[]
    for box in ROWS:
        centers=list(window_centers(paint,box))
        assert len(centers)>=40,(box,len(centers))
        counts.append(len(centers))
        for x,y,w,h in centers:
            draw.ellipse((x-w*.30,y-h*.35,x+w*.30,y+h*.35),fill='#ffd392')
            proof.rectangle((x-w*.5,y-h*.5,x+w*.5,y+h*.5),outline='#fa00ff')
    for x,y in DOORS:
        draw.ellipse((x-1.8,y-2.5,x+1.8,y+2.5),fill='#ffd392')
    mask.save(OUTPUT/'cabin-window-mask.png')
    review.save(OUTPUT/'cabin-mask-review.png')
    xml=SOURCE.with_suffix('.xml').read_text().replace('A6-EDA.png','A6-EVN.png')
    (OUTPUT/'A6-EVN.xml').write_text(xml)
    (OUTPUT/'cabin-mask.json').write_text(json.dumps({
        'source':str(SOURCE.relative_to(BASE)), 'passengerPanesPerUVRow':counts,
        'doorPanes':len(DOORS), 'registration':'A6-EVN',
        'flightEvidence':'https://planefinder.net/data/flight/EK225/history/5-83237751',
        'paintEvidence':'https://www.aussieairliners.org/a380i/267/a6evn.html',
        'engineEvidence':'https://www.jetphotos.com/info/A380-267'
    },indent=2)+'\n')
    print('A380 painted cabin panes per UV row',counts)


if __name__=='__main__':
    main()
