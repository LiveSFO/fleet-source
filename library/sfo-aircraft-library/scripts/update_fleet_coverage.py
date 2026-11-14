"""Reconcile every captured SFO combination with real files and review evidence."""
from pathlib import Path
import json,hashlib,datetime
BASE=Path(__file__).resolve().parents[1]/'assets/airliners'
inv=json.loads((BASE/'traffic/2026-11-11-build-inventory.json').read_text());cfg=json.loads((BASE/'fleet-build-config.json').read_text())
ALIASES={'E175':'E75L','A221':'BCS1','B76W':'B763','73H':'B738'}
FAMILIES={'A20N':'a20n','A359':'a359','B788':'b788','GL5T':'gl5t','B38M':'b38m','BCS3':'a223','B738':'b738','B737':'b737','B739':'b739','B39M':'b39m','A319':'a319','A320':'a320','A321':'a321','A21N':'a21n','BCS1':'a221','B789':'b789-current','B78X':'b78x','A332':'a332','A388':'a388','B748':'b748f','B748F':'b748f','B77W':'b77w','B763':'b763','B752':'b752','B753':'b753','CRJ9':'crj900','A35K':'a35k','CL60':'cl60','GLF5':'glf5'}
OPERATORS={'UA':'united','AA':'american','AS':'alaska','DL':'delta','WN':'southwest','B6':'jetblue','AC':'air-canada','CM':'copa','KL':'klm','EK':'emirates','KE':'korean-air-cargo','AF':'air-france','CX':'cathay-pacific','NH':'ana','CA':'air-china','BR':'eva-air','YP':'air-premia','ZG':'zipair','SQ':'singapore-airlines','LH':'lufthansa','MX':'breeze','AM':'aeromexico','AV':'avianca','F8':'flair','F9':'frontier','HA':'hawaiian','NZ':'air-new-zealand','JL':'japan-airlines','BA':'british-airways','AI':'air-india','BF':'french-bee','CI':'china-airlines','EI':'aer-lingus','JX':'starlux','LX':'swiss','OZ':'asiana','PR':'philippine-airlines','QF':'qantas','TK':'turkish-airlines','VN':'vietnam-airlines'}
NAME_MAP={'United':'united','United Express':'united','American Airlines':'american','American Eagle':'american','Alaska Airlines':'alaska','Delta Air Lines':'delta','Delta':'delta','Southwest Airlines':'southwest','Air Canada':'air-canada','KLM':'klm','Korean Air Cargo':'korean-air-cargo','Korean Air':'korean-air-cargo','Air France':'air-france','Cathay Pacific':'cathay-pacific','Hawaiian Airlines':'hawaiian'}
VARIANTS={
 'UA/CRJ2':('crj200','united'),
 'KJ/B744':('b744f','airzeta'),
 '8C/B763':('b763f','amazon-air'),
 'FX/B763':('b763f','fedex'),
 'GB/B762':('b762f','abx-air'),
 'CI/B77L':('b77f','china-airlines-cargo'),
 'F8/73H':('b738-current','flair'),
 'PD/E295':('e295','porter'),
 'Flexjet/E545':('e545','flexjet'),
 'Neojets/GALX':('galx','neojets'),
 'NetJets/C700':('c700','netjets'),
 'NetJets/CL60':('cl60','netjets'),
 'Silver Air/GLF5':('glf5','silver-air'),
 'EI/A332':('a332-ge','aer-lingus'),
}
SPECIAL_PAINTS={
 'PR/A35K / Philippine Airlines (85th Anniversary Sticker Livery)':('a35k','philippine-airlines-85-years'),
 'AA/B738 / American Airlines (AirCal Retro Livery)':('b738-current','american-aircal'),
 'UA/A320 / United Airlines (Retro Livery)':('a320','united-friend-ship'),
 'F9/A20N / Frontier (Adams the Green Salamander Livery)':('a20n','frontier-adams'),
 'F9/A20N / Frontier (Marshall the Ring-tailed Cat Livery)':('a20n','frontier-marshall'),
}
checks=json.loads((BASE/'fleet-validation-summary.json').read_text()) if (BASE/'fleet-validation-summary.json').exists() else []
validated={(r['aircraft'],r['livery']):r for r in checks};reviews=json.loads((BASE/'visual-reviews.json').read_text()) if (BASE/'visual-reviews.json').exists() else {}
rows=[]
for combo in inv['combinations']:
 typ=ALIASES.get(combo['icaoType'],combo['icaoType']);family=FAMILIES.get(typ);paint=OPERATORS.get(combo.get('iata')) or NAME_MAP.get(combo['operator']);state='not-built';issues=[]
 if family=='crj900':paint='air-canada-express'
 if family=='gl5t':paint='netjets'
 if typ=='B738' and paint=='united':family='b738-current'
 if typ=='B78X' and combo.get('iata')=='KE':paint='korean-air'
 if typ=='E75L':family='e75l'
 if typ=='B772':family='b772'
 if typ=='A333':family='a333';paint='fiji-airways' if combo.get('iata')=='FJ' else paint
 if typ=='UNKNOWN':issues.append('Published flight record does not report an aircraft type; cannot identify the required model.')
 # Preserve special paints as their own task even if the normal airline model exists.
 special=combo.get('livery') or combo.get('specialLivery') or (combo['operator'] if 'Livery' in combo['operator'] or ' / ' in combo['id'] else None)
 matched_special=False
 if combo['id'] in VARIANTS:family,paint=VARIANTS[combo['id']]
 if combo['id'] in SPECIAL_PAINTS:
  family,paint=SPECIAL_PAINTS[combo['id']];matched_special=True
 if combo.get('assetSelector'):
  family,paint=combo['assetSelector'].split('/')
 if special and typ=='B738' and paint=='united' and 'Star Alliance' in special:
  family='b738-current';paint='united-star-alliance';matched_special=True
 if special and not matched_special:issues.append('Special-livery artwork must be matched separately.')
 path=BASE/family/'exports'/(paint+'.glb') if family and paint else None
 if path and path.exists() and (not special or matched_special):
  state='built-awaiting-review';check=validated.get((family,paint));sha=hashlib.sha256(path.read_bytes()).hexdigest();review=reviews.get(family+'/'+paint,{})
  if check and check.get('status')=='failed':issues.append(check['error'])
  if check and check.get('status')!='failed' and check.get('sha256')==sha:state='automated-checks-passed-awaiting-visual-review'
  elif check and check.get('status')!='failed':issues.append('Asset was rebuilt after its last automated check; revalidation is required.')
  if check and check.get('sha256')==sha and check.get('status')!='failed' and review.get('sha256')==sha and review.get('status')=='accepted':state='accepted'
  elif check and check.get('sha256')==sha and check.get('status')!='failed' and review.get('sha256')==sha and review.get('status')=='multi-angle-reviewed':state='multi-angle-reviewed'
  elif check and check.get('sha256')==sha and check.get('status')!='failed' and review.get('sha256')==sha and review.get('status')=='profile-reviewed':state='profile-reviewed-further-detail-review-pending'
  if review.get('sha256')==sha:issues.extend(review.get('openIssues',[]))
  if family in cfg:
   names=[v['name'] for v in cfg[family]['liveries'] if v['id']==paint]
   if names and any(t in names[0].lower() for t in ['source era','source paint','globe era','classic']):issues.append('Source-era paint needs a current-aircraft match before full coverage is accepted.')
  if family=='b739':issues.append('737-900 versus -900ER exit configuration still requires visual verification.')
  asset={'aircraft':family,'livery':paint,'glb':str(path.relative_to(BASE)),'sha256':sha}
 else:asset=None
 rows.append({'id':combo['id'],'operator':combo['operator'],'reportedType':combo['icaoType'],'canonicalType':typ,'specialLivery':special,'state':state,'asset':asset,'openIssues':issues,'source':combo.get('source','official-airport')})
summary={state:sum(r['state']==state for r in rows) for state in sorted({r['state'] for r in rows})}
report={'inventory':'traffic/2026-11-11-build-inventory.json','dateLocal':inv['dateLocal'],'scope':inv['scope'],'officialSnapshots':inv['officialSnapshots'],'officialOperatingFlights':inv['officialOperatingFlights'],'updatedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'counts':summary,'combinations':rows}
(BASE/'sfo-build-coverage.json').write_text(json.dumps(report,indent=2)+'\n');print(summary)
