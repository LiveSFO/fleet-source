"""Select the licensed Global-family exterior and author two operator paints."""
from copy import deepcopy
import json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont

BASE=Path(__file__).resolve().parents[1]/'assets/airliners'
cfgfile=BASE/'fleet-build-config.json'
cfg=json.loads(cfgfile.read_text())
out=BASE/'glex/generated';out.mkdir(exist_ok=True,parents=True)
source=BASE/'preparation/Global5000-xplane/upstream/Bombardier Global 5000/liveries/Netjets/objects/gl5t_1.png'
image=Image.open(source).convert('RGBA')
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf',68)
mark=Image.new('RGBA',(350,110));draw=ImageDraw.Draw(mark)
draw.text((0,3),'N166',font=font,fill='#141517',stroke_width=0)
advance=draw.textlength('N166',font=font)
draw.text((advance,3),'QS',font=font,fill='#a4262b')
mark=mark.crop(mark.getbbox());mark.thumbnail((274,75))
# Registration islands on the original atlas; surrounding stripes/panel detail
# and all original source bytes are preserved. The lower island is mirrored.
for box,mirror in [((3320,1113,3630,1210),False),((3320,2118,3630,2215),True)]:
    patch=Image.new('RGBA',(box[2]-box[0],box[3]-box[1]),(250,250,250,255))
    decal=mark.transpose(Image.Transpose.FLIP_LEFT_RIGHT) if mirror else mark
    patch.alpha_composite(decal,((patch.width-decal.width)//2,(patch.height-decal.height)//2))
    image.paste(patch,box[:2])
image.save(out/'netjets-n166qs.png')

art=BASE/'preparation/brand-art'
word=Image.new('RGBA',(900,180));draw=ImageDraw.Draw(word)
vista_font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Italic.ttf',140)
draw.text((12,-2),'VistaJet',font=vista_font,fill='#ae1b28')
word.crop(word.getbbox()).save(art/'vistajet-wordmark-reconstruction.png')
(art/'vistajet-wordmark-reconstruction.asset.json').write_text(json.dumps({
    'method':'Original typographic reconstruction using installed Arial Italic; approximate operator wordmark, not extracted photographic artwork.',
    'references':['https://www.vistajet.com/en/stories/three-steps-to-private-air-travel-perfection/',
                  'https://www.vistajet.com/globalassets/documents/factsheets/global-6000.pdf'],
    'scope':'Silver/red representative VistaJet Global 6000 paint. Font and exact airframe-specific stripe placement remain reconstructed.'
},indent=2)+'\n')

model=deepcopy(cfg['gl5t'])
model.update(label='Bombardier Global 6000 · BR710',dimensions={'length':30.30,'span':28.65},
             pbrTexturesFrom='gl5t/generated',
             fuselageInsertions=[{'station':-5.47,'length':.80,'windowTemplate':[-5.23,-4.90],
                                  'basis':'Bombardier Global 6000 30.30 m versus Global 5000 29.50 m exterior length; retained common family sections. Added cabin barrel falls between native panes.'}],
             notes=['GPL Global 5000-family exterior adapted to Global 6000 length with an explicit 0.80 m cabin insertion, added panes, and retained native wings, landing gear and engine hinges.',
                    'Cockpit/antenna refinements and exact registration paint remain representative family adaptations; this is not factory Global 6000 CAD.'])
model['liveries']=[
    {'id':'netjets','name':'NetJets · Global 6000 · N166QS',
     'texture':'../../../../glex/generated/netjets-n166qs.png'},
    {'id':'vistajet','name':'VistaJet · Global 6000 · 9H-VJS',
     'texture':'liveries/Netjets/objects/gl5t_1.png',
     'authoredPaint':{
         'bodyPartPattern':'^glt5-(19|27|28|29)-surface$', 'finPartPattern':'^glt5-(0|4|39)-surface$',
         'isolatePartTextures':True,'bodyCenterZ':1.35,'resolution':4096,
         'bodyColorSRGB':[193,197,201],'finColorSRGB':[193,197,201],
         'bodyBands':[{'range':[-.15,-.105],'colorSRGB':[174,27,40]}],
         'finBands':[{'range':[-.28,-.245],'slope':.72,'colorSRGB':[174,27,40]}],
         'finGraphics':[],
         'references':['https://www.vistajet.com/en/stories/three-steps-to-private-air-travel-perfection/'],
         'artworkMetadata':['preparation/brand-art/vistajet-wordmark-reconstruction.asset.json']},
     'operatorFinishes':[{'name':'VistaJet metallic silver nacelles','partPattern':'^(glt5-(16|46|43)|reverser-(10|11|47|48))-surface$',
                          'flatColor':True,'colorSRGB':[193,197,201],'metallic':.48,'roughness':.29},
                         {'name':'VistaJet silver paint reflectance','partPattern':'^glt5-(0|4|19|27|28|29|39)-surface$',
                          'preserveColor':True,'colorSRGB':[193,197,201],'metallic':.44,'roughness':.30,'coat':.38}],
     'registrationDecals':[{'image':'preparation/brand-art/9h-vjs-registration.png','partPattern':'^glt5-(16|46)-surface$',
                            'center':[6.15,2.30],'size':[1.36,.245]},
                           {'image':'preparation/brand-art/vistajet-wordmark-reconstruction.png','partPattern':'^glt5-0-surface$',
                            'center':[9.5,4.92],'size':[1.75,.34],'bothSides':True}]}
]
cfg['glex']=model
cfgfile.write_text(json.dumps(cfg,indent=2)+'\n')
print('Prepared native Global 6000 family adaptation and two paint selections')
