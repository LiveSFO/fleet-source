"""Record explicitly inspected contact sheets, bound to asset/image hashes.

Supply only sheet numbers actually inspected. Rendering alone never accepts an
asset; this records a multi-angle exterior review, not factory fidelity.
"""
from pathlib import Path
import datetime,hashlib,json,sys
BASE=Path(__file__).resolve().parents[1]/'assets/airliners'
sheets={int(s) for s in sys.argv[1:]}
if not sheets:raise ValueError('Supply inspected sheet numbers')
index=json.loads((BASE/'previews/detail-pass/sheet-index.json').read_text())
cfg=json.loads((BASE/'fleet-build-config.json').read_text())
checks={(r['aircraft'],r['livery']):r for r in json.loads((BASE/'fleet-validation-summary.json').read_text())}
path=BASE/'visual-reviews.json';reviews=json.loads(path.read_text());now=datetime.datetime.now(datetime.timezone.utc).isoformat();recorded=0
issues={
 'a339':['Fan, pylon and cascade engineering are authored visualization details; not production CAD.'],
 'a35k':['The -1000 wing/nacelle detail is adapted from the -900 family; internal gear engineering and XWB-97-specific surfaces remain approximate.'],
 'b762f':['Converted-freighter door stations and exact ABX paint remain representative.'],
 'b763f':['Exact production-freighter versus converted-freighter fittings and registration paint remain representative; cargo door is fixed closed.'],
 'b739':['Reported 737-900 versus -900ER exit configuration is not verified per captured registration.'],
 'be9l':['C90A source adapted to the C90GT envelope; PT6A-135A nacelle details remain approximate.'],
 'b350':['Detailed B300-family source represents a King Air 360; exact registration paint and small antenna fittings remain representative.'],
 'c750':['Close-up antenna, bay and exact registration paint details remain representative.'],
 'glex':['Global 5000-family sections adapted with a 0.80 m cabin insertion. Small Global 6000 variant fittings, exact registration paint and loaded height remain approximate.'],
 'ec35':['P2-family exterior and reconstructed medical-operator paint; registration-specific equipment and P3 rotor/fairing differences remain approximate.'],
 'pc12':['Classic PC-12/45 family source; exact Guardian Flight registration paint remains representative.']}
for selector,evidence in index.items():
 number=int(Path(evidence['sheet']).stem.rsplit('-',1)[1])
 if number not in sheets:continue
 family,livery=selector.split('/');glb=BASE/family/'exports'/(livery+'.glb');sha=hashlib.sha256(glb.read_bytes()).hexdigest();check=checks.get((family,livery),{})
 assert sha==evidence['sha256']==check.get('sha256') and check.get('status')!='failed',selector
 for view,record in evidence['views'].items():
  assert record['sha256']==sha and hashlib.sha256((BASE/record['image']).read_bytes()).hexdigest()==record['imageSHA256'],selector+'/'+view
 model=cfg.get(family,{});old=reviews.get(selector,{})
 open_issues=list(issues.get(family,[]))
 if model.get('format')=='reference-loft':open_issues.append('Authored exterior study: exact close-up type contours, gear engineering, small fittings and tail-specific paint are not established by the dimension envelope or these preview views.')
 paint=next((l for l in model.get('liveries',[]) if l['id']==livery),{'name':livery})
 if any(t in paint['name'].lower() for t in ['globe era','source era','historical']):open_issues.append('Source-era paint; not a verified current-aircraft livery match.')
 if selector=='b789-current/virgin-atlantic':open_issues.append('Representative source registration G-VZIG; captured movement identified as G-VCRU.')
 if selector=='a21n/frontier-chopper':open_issues.append('Original shark artwork approximates the real motif; exact captured paint assignment is not established.')
 record={
  'status':'accepted' if old.get('status')=='accepted' and old.get('sha256')==sha else 'multi-angle-reviewed',
  'sha256':sha,'reviewedAtUTC':now,
  'scope':'Assistant visual inspection of eight labeled source-scene renders at exterior-preview distance: overview, starboard, front, rear, plan, deployed mechanisms, fully stowed gear and cabin lighting. Export geometry, native clips and repeated controller cycles checked independently in Three.js. This is not a browser render test, per-frame collision audit or factory contour/paint certification.',
  'proof':[evidence['sheet']], 'sheetRow':evidence['row'],
  'sheetSHA256':hashlib.sha256((BASE/evidence['sheet']).read_bytes()).hexdigest(),
  'views':evidence['views'],
  'observations':['Both sides and main silhouettes inspected at the saved render resolution.',
                  'Deployed/stowed poses and night-window appearance inspected; model-specific limitations are recorded separately.'],
  'fidelityNotes':model.get('notes',[]),'openIssues':open_issues,
  'geometryClass':'authored-exterior-study' if model.get('format')=='reference-loft' else 'adapted-source-exterior'}
 if old.get('status')=='accepted':record['priorAcceptance']=old
 reviews[selector]=record;recorded+=1
path.write_text(json.dumps(reviews,indent=2)+'\n');print('Recorded',recorded,'explicit multi-angle reviews')
