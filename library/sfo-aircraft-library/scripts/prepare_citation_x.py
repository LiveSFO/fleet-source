"""Preserve the painted Citation X pane footprints as switchable emission."""
from pathlib import Path
import json
from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parents[1]/'assets/airliners'
source = BASE/'preparation/CitationX/upstream/Models/livery1.png'
image = Image.open(source).convert('RGB')
assert image.size == (2048,2048)
regions = [(x-9,310,x+9,337) for x in (518,590,662,735,807,879)]
regions += [(x-9,799,x+9,826) for x in (1176,1248,1320,1394,1466,1536,1608)]
mask = Image.new('RGB',image.size)
draw = ImageDraw.Draw(mask)
review = image.copy()
review_draw = ImageDraw.Draw(review)
for region in regions:
    draw.rounded_rectangle(region,radius=3,fill='white')
    review_draw.rectangle(region,outline='#f01bd2',width=3)
folder = BASE/'c750/generated'
folder.mkdir(exist_ok=True,parents=True)
mask.save(folder/'cabin-window-mask.png')
review.thumbnail((1200,1200))
review.save(folder/'cabin-mask-review.png')
(folder/'cabin-mask.json').write_text(json.dumps({
    'reference':str(source.relative_to(BASE)),
    'regions':regions,
    'scope':'Six source port panes and seven starboard panes, including the source door pane.',
},indent=2)+'\n')
