"""Expose only existing exports; readiness is independent of file existence."""
from pathlib import Path
import json,hashlib
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'assets/airliners';cfg=json.loads((BASE/'fleet-build-config.json').read_text());catalog={};reviewfile=BASE/'visual-reviews.json';reviews=json.loads(reviewfile.read_text()) if reviewfile.exists() else {}
for key,model in cfg.items():
 if model.get('preparationOnly'):continue
 liveries=[[l['id'],l['name']] for l in model['liveries'] if (BASE/key/'exports'/(l['id']+'.glb')).exists()]
 if liveries:
  accepted=all(reviews.get(key+'/'+l[0],{}).get('status')=='accepted' and reviews[key+'/'+l[0]].get('sha256')==hashlib.sha256((BASE/key/'exports'/(l[0]+'.glb')).read_bytes()).hexdigest() for l in liveries)
  detail_checked=all(reviews.get(key+'/'+l[0],{}).get('status') in ['accepted','multi-angle-reviewed'] and reviews[key+'/'+l[0]].get('sha256')==hashlib.sha256((BASE/key/'exports'/(l[0]+'.glb')).read_bytes()).hexdigest() for l in liveries)
  profile_checked=all(reviews.get(key+'/'+l[0],{}).get('status') in ['accepted','profile-reviewed'] and reviews[key+'/'+l[0]].get('sha256')==hashlib.sha256((BASE/key/'exports'/(l[0]+'.glb')).read_bytes()).hexdigest() for l in liveries)
  label=model['label']+('' if accepted else ' · eight-view reviewed' if detail_checked else ' · profile checked; detail review pending' if profile_checked else ' · review pending')
  if key=='b789':label='Boeing 787-9 · archived prototype'
  if key=='e175':label='Embraer E175 · legacy winglet prototype'
  catalog[key]={'name':label,'liveries':liveries}
(ROOT/'viewer/fleet-catalog.js').write_text('export const fleetCatalog='+json.dumps(catalog,indent=2)+';\n')
print('Aircraft entries',len(catalog),'livery exports',sum(len(x['liveries']) for x in catalog.values()))
