"""Independent pressure-shell sections and Global 7500 cabin/paint refinement.

Dimensioned figures constrain dimensions. Photographs constrain the authored
layout; no reference photograph or manufacturer drawing becomes a texture.
"""
import json,hashlib
from pathlib import Path
BASE=Path(__file__).resolve().parents[1]/'assets/airliners'
p=BASE/'reference-jet-profiles.json';data=json.loads(p.read_text())
refs={
 'cl30':('width',2.34,'https://jst.gob.ar/files/informes/AE/2024/121824-138819184/IPROV-138819184-24.pdf',
         'Manufacturer BD-100 three-view reproduced in official JST provisional report, page 15 figure 5: 7 ft 8 in / 2.34 m fuselage width. Circular section follows manufacturer CH350 ATA06 family description.'),
 'cl35':('width',2.34,'https://smartpubs.aero.bombardier.com/viewer/api/resources/sfp-page/CH350MM/SFP/CH350/ch350/system-description/06/index.html',
         'Retained BD-100 family 2.34 m cross-section, independently of the larger 350 winglets. Manufacturer describes a constant circular fuselage section.'),
 'glf4':('width',2.43,'https://resources.globalair.com/specs/aircraftbrochures/3323_g450_productbrochure_english.pdf',
         'Approximate external section measured from the manufacturer front drawing, brochure page 19: 107/1044 of 23.72 m span = 2.43 m. Published 2.24 m cabin width is internal, not external. Figure estimate, not a type-certificate width.')}
for key,(_,width,url,basis) in refs.items():
 d=data[key]
 for column in (2,3):
  scale=width/(2*max(r[column] for r in d['profile']))
  for r in d['profile']:r[column]*=scale
 # Leave planform and mechanism locations alone; fairing width follows only
 # the shell width, never wingspan.
 d['sectionReference']={'width':width,'source':url,'basis':basis,'scope':'Pressure shell only; contour and loaded ground attitude remain authored approximations.'}
 if basis not in d['notes']:d['notes'].append(basis)
d=data['gl7t']
d['windows']=[6.70,15,.965,3.10,.405,.59]
d['ovalWindows']=False
d['windowLayoutReference']={'source':'reference/Bombardier-Global7500-brochure-2021.pdf','page':4,
 'method':'Fifteen port-side panes counted in the manufacturer exterior photograph; authored spacing/size fitted to the exterior, not claimed factory station coordinates.',
 'operatorReference':'https://www.netjets.com/en-us/bombardier-global-7500-specs'}
paint=d['liveries'][0]['paint'];paint['base']='f5f5f4';paint['fin']='f5f5f4';paint['winglet']='f5f5f4'
path=[[0,1.69],[4,1.98],[20,2.05],[23.7,2.50],[26,3.28],[30.7,4.06]]
paint['bands']=[]
for low,high,color in [(0,.14,'25282b'),(.18,.215,'ab2732'),(.255,.285,'25282b')]:
 paint['bands'].append([[[x,z+low] for x,z in path],[[x,z+high] for x,z in path],color])
paint['finBands']=[['25282b',-.22,-.06,.89],['ab2732',-.01,.025,.89],['25282b',.075,.11,.89]]
note='Global 7500 pane count/layout refined from manufacturer exterior photography; NetJets charcoal/red stripe layout reconstructed from operator imagery. Exact station coordinates, small fittings and registration-specific paint remain representative.'
if note not in d['notes']:d['notes'].append(note)
p.write_text(json.dumps(data,indent=2)+'\n')
for file,url in [('Bombardier-Global7500-brochure-2021.pdf','https://resources.globalair.com/specs/aircraftbrochures/4291_Global_7500_Brochure_Feb2021_ENG.pdf'),('Gulfstream-G450-product-brochure.pdf',refs['glf4'][2])]:
 f=BASE/'reference'/file
 f.with_suffix('.source.json').write_text(json.dumps({'url':url,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'content':'Manufacturer-authored brochure served by a public mirror. Local reference only; exclude from portable asset distribution.'},indent=2)+'\n')
print('Refined CL300/350 and G450 sections; Global 7500 pane layout and paint')
