"""Make labeled, deterministic profile contact sheets for the captured inventory.

This creates review evidence, not an acceptance decision. Inspect the sheets before
adding matching records to visual-reviews.json.
"""
from pathlib import Path
import argparse, hashlib, json, math
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'assets/airliners'
parser = argparse.ArgumentParser()
parser.add_argument('--frames', type=Path, default=Path('/tmp/sfo-review-frames'))
args = parser.parse_args()
coverage = json.loads((BASE / 'sfo-build-coverage.json').read_text())
selectors = sorted({row['asset']['aircraft'] + '/' + row['asset']['livery']
                    for row in coverage['combinations'] if row['asset']})
output = BASE / 'previews'
output.mkdir(exist_ok=True)
font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 18)
records = {}
for page in range(math.ceil(len(selectors) / 16)):
    batch = selectors[page * 16:(page + 1) * 16]
    sheet = Image.new('RGB', (2040, 1160), '#e6e9ee')
    draw = ImageDraw.Draw(sheet)
    name = f'sfo-2026-11-11-profile-{page + 1:02d}.png'
    for index, selector in enumerate(batch):
        family, livery = selector.split('/')
        source = args.frames / f'{family}-{livery}-profile.png'
        frame = Image.open(source).convert('RGB')
        frame.thumbnail((500, 248))
        x, y = (index % 4) * 510, (index // 4) * 290
        sheet.paste(frame, (x + (510 - frame.width) // 2, y + 5))
        draw.text((x + 8, y + 256), selector, fill='#162236', font=font)
        glb = BASE / family / 'exports' / f'{livery}.glb'
        records[selector] = {
            'sha256': hashlib.sha256(glb.read_bytes()).hexdigest(),
            'profileImageSHA256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'proof': [f'previews/{name}'],
            'tile': index + 1,
        }
    sheet.save(output / name)
(output / 'sfo-profile-sheet-manifest.json').write_text(json.dumps(records, indent=2) + '\n')
print(f'Created {page + 1} sheets for {len(records)} current exports')
