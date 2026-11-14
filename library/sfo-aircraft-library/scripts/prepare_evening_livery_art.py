"""Prepare decals from pinned GPL paint and verified Commons vectors."""
from pathlib import Path
from math import cos, radians, sin

import numpy as np
from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).resolve().parents[1] / 'assets' / 'airliners' / 'preparation'
ART = BASE / 'brand-art'


def crop(name, source, box):
    image = Image.open(ART/source).convert('RGBA')
    image = image.crop(tuple(round(value*dimension) for value,dimension in zip(box,image.size*2)))
    return save(name,image)


def save(name, image):
    image.crop(image.getchannel('A').getbbox()).save(ART/(name+'.png'))


def text(name, caption, color, *, size=110, spacing=0, font='/System/Library/Fonts/Helvetica.ttc'):
    face = ImageFont.truetype(font,size)
    image = Image.new('RGBA',(max(500,round(face.getlength(caption)+len(caption)*spacing+80)),size*2))
    draw = ImageDraw.Draw(image)
    x = 20
    for c in caption:
        draw.text((x,8),c,font=face,fill=color)
        x += face.getlength(c)+spacing
    save(name,image)


def qantas():
    source=BASE/'Pilot2938-FG-liveries/upstream/787/787-9/QFA.png'
    image=Image.open(source).convert('RGB').resize((2400,2400),Image.Resampling.LANCZOS)
    title=image.crop((1010,1340,1585,1420))
    rgb=np.asarray(title,dtype=np.int16)
    alpha=np.clip((178-rgb.mean(2))*1.8,0,255).astype(np.uint8)
    title.putalpha(Image.fromarray(alpha));save('qantas-title',title)
    fin=image.crop((2008,625,2394,975))
    mask=Image.new('L',fin.size)
    ImageDraw.Draw(mask).polygon([(7,308),(265,23),(380,7),(244,345)],fill=255)
    fin.putalpha(mask);save('qantas-tail-source',fin)
    text('qantas-spirit','Spirit of Australia','#2c2c2c',size=74)


def stylized_starlux():
    text('starlux-title','STΛRLUX','#222832',spacing=9)
    fin=Image.new('RGBA',(580,680))
    draw=ImageDraw.Draw(fin)
    draw.polygon([(87,139),(265,139),(437,300),(257,300)],fill='#7d5d47')
    draw.polygon([(143,370),(310,370),(489,536),(317,536)],fill='#b39763')
    draw.polygon([(140,112),(165,194),(238,215),(164,238),(139,321),
                  (118,238),(39,215),(117,193)],fill='#fff9ed')
    save('starlux-fin-stripes',fin)


def pal_anniversary():
    image=Image.new('RGBA',(820,360))
    draw=ImageDraw.Draw(image)
    blue,red='#233a82','#d3252e'
    draw.ellipse((19,15,269,153),outline=blue,width=31)
    draw.ellipse((9,127,295,314),outline=blue,width=33)
    draw.line([(399,30),(668,30)],fill=red,width=35)
    draw.line([(407,27),(372,157)],fill=red,width=35)
    draw.arc((342,127,687,320),278,175,fill=red,width=35)
    font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',65)
    draw.text((683,220),'YEARS',font=font,fill=blue)
    save('pal-85-years',image)


def extract_777_art(name, source, box, ink):
    """Isolate the printed ink from the pinned FlightGear paint atlas."""
    source = BASE/'paint-donors/clean-777'/f'{source}.png'
    pixels = np.asarray(Image.open(source).convert('RGB').crop(box), dtype=np.float32)
    red, green, blue = pixels.transpose(2, 0, 1)
    if ink == 'red':
        alpha = np.clip((red - (green + blue) / 2) / 173, 0, 1)
        color = '#e3192b'
    elif ink == 'blue':
        alpha = np.clip((blue - red) / 155, 0, 1)
        color = '#122c75'
    else:
        alpha = np.clip((176 - pixels.max(2)) / 137, 0, 1)
        color = '#18191a'
    image = Image.new('RGBA', (pixels.shape[1], pixels.shape[0]), color)
    image.putalpha(Image.fromarray((255 * alpha).astype(np.uint8)))
    save(name, image)


def canada_roundel():
    image = Image.new('RGBA', (490, 490))
    draw = ImageDraw.Draw(image)
    red = '#e82737'
    draw.ellipse((12, 12, 478, 478), outline=red, width=25)
    draw.polygon([(245, 78), (273, 149), (302, 135), (290, 216),
                  (343, 167), (354, 198), (402, 188), (386, 241),
                  (410, 253), (308, 320), (320, 346), (254, 336),
                  (258, 411), (233, 411), (237, 336), (171, 346),
                  (181, 320), (80, 253), (104, 241), (88, 188),
                  (136, 198), (147, 167), (200, 216), (188, 135),
                  (217, 149)], fill=red)
    save('air-canada-fin-roundel', image)


def united_globe():
    image = Image.new('RGBA', (800, 800))
    draw = ImageDraw.Draw(image)
    draw.ellipse((20, 20, 780, 780), fill='#154e99', outline='#67b4e5', width=13)
    blue = '#66b3e5'

    def project(lat, lon):
        tilt = radians(31)
        x = 380 * cos(lat) * sin(lon)
        y = 380 * sin(lat)
        return (400 + x*cos(tilt) - y*sin(tilt), 400 - x*sin(tilt) - y*cos(tilt))

    for latitude in range(-60, 75, 15):
        draw.line([project(radians(latitude), radians(lon)) for lon in range(-90, 91, 2)], fill=blue, width=11)
    for longitude in range(-75, 90, 15):
        draw.line([project(radians(lat), radians(longitude)) for lat in range(-90, 91, 2)], fill=blue, width=11)
    save('united-fin-globe', image)


def review_corrections():
    extract_777_art('ana-forward-title', 'ANA', (279, 337, 461, 386), 'blue')
    extract_777_art('jal-forward-title', 'JAL', (296, 348, 823, 380), 'black')
    extract_777_art('jal-tail-crane', 'JAL', (1815, 165, 1961, 309), 'red')
    extract_777_art('cca-english-title', 'CCA', (274, 363, 405, 389), 'black')
    extract_777_art('cca-chinese-title', 'CCA', (503, 358, 796, 388), 'black')
    extract_777_art('cca-tail-phoenix', 'CCA', (1840, 141, 1978, 290), 'red')
    text('ana-inspiration', 'Inspiration of JAPAN', '#17356c', size=92)
    text('ana-tail-type', 'ANA', '#ffffff', size=128, font='/System/Library/Fonts/Supplemental/Arial Bold.ttf')
    path = ART/'ana-tail-type.png'
    with Image.open(path) as original:
        turned = original.rotate(46, resample=Image.Resampling.BICUBIC, expand=True)
        opposite = original.rotate(-46, resample=Image.Resampling.BICUBIC, expand=True)
    save('ana-tail-type', turned)
    save('ana-tail-type-opposite', opposite)
    canada_roundel()
    united_globe()


if __name__=='__main__':
    crop('pal-title','Philippine Airlines logo.png',(.255,0,1,1))
    crop('pal-tail','Philippine Airlines logo.png',(0,0,.245,1))
    crop('aer-lingus-tail','Aer Lingus 2022 logo.png',(.808,0,1,1))
    crop('eva-title','Logo EVA Air 02.png',(0,0,.702,1))
    crop('swiss-title','Swiss International Air Lines Logo 2011.png',(.32,0,1,1))
    eva=Image.open(ART/'Logo EVA Air 02.png').convert('RGBA')
    w,h=eva.size
    globe=eva.crop((round(w*.781),round(h*.2),round(w*.925),round(h*.82)))
    alpha=Image.new('L',globe.size)
    ImageDraw.Draw(alpha).ellipse((0,0,*globe.size),fill=255)
    globe.putalpha(alpha);save('eva-tail-globe',globe)
    swiss=Image.new('RGBA',(340,340))
    draw=ImageDraw.Draw(swiss)
    draw.rectangle((120,0,220,340),fill='white')
    draw.rectangle((0,120,340,220),fill='white')
    save('swiss-cross',swiss)
    french=Image.open(ART/'French Bee Logo.png').convert('RGBA')
    x,y=french.size
    petals=french.crop((round(x*.858),0,x,y))
    save('french-bee-petals',petals)
    # Four white petals on the vertical tail are separated from the side title.
    white=Image.new('RGBA',petals.size,'white');white.putalpha(petals.getchannel('A'))
    save('french-bee-tail',white)
    text('ei-duo','EI-DUO','#123a40',size=66)
    text('xa-dat','XA-DAT','#132546',size=66)
    text('rp-c3510','RP-C3510','#223a69',size=66)
    text('rp-c3512','RP-C3512','#223a69',size=66)
    text('hl8383','HL8383','#434751',size=66)
    stylized_starlux()
    qantas()
    pal_anniversary()
    review_corrections()
