"""Resume multi-angle source-scene review renders, keyed to actual export hashes.

Run inside Blender. No visual acceptance is assigned by this script.
"""
from pathlib import Path
import datetime, fcntl, hashlib, json, os, sys, traceback

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from render_fleet_review import render

BASE=ROOT/'assets/airliners'
OUTPUT=BASE/'previews/detail-pass'
OUTPUT.mkdir(exist_ok=True,parents=True)
MANIFEST=OUTPUT/'render-manifest.json'
records=json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
rows=json.loads((BASE/'sfo-build-coverage.json').read_text())['combinations']
selectors=sorted({row['asset']['aircraft']+'/'+row['asset']['livery'] for row in rows})
arguments=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
if arguments:selectors=[s for s in selectors if s in arguments or s.split('/')[0] in arguments]
views=os.environ.get('FLEET_DETAIL_VIEWS','overview,starboard,front,rear,plan,mechanisms,stowed,cabin').split(',')
renderer=hashlib.sha256((ROOT/'scripts/render_fleet_review.py').read_bytes()).hexdigest()
# This revision only normalizes legacy name-bound rigs before the unchanged
# ID-bound pose path. Existing successful views from that renderer remain valid;
# the legacy posed views previously failed and therefore have no reusable record.
compatible_renderers={renderer,'fc80c6a5a0245b46ce611a6feea374f8024241bc6e8d38a18ab64e248b080356'}
failed=[]
for selector in selectors:
    family,livery=selector.split('/')
    sha=hashlib.sha256((BASE/family/'exports'/f'{livery}.glb').read_bytes()).hexdigest()
    for mode in views:
        key=selector+'/'+mode
        path=OUTPUT/f'{family}-{livery}-{mode}.png'
        record=records.get(key,{})
        if record.get('sha256')==sha and record.get('rendererSHA256') in compatible_renderers and path.exists():continue
        try:
            render(key,OUTPUT,int(os.environ.get('FLEET_REVIEW_WIDTH','840')))
            records[key]={'sha256':sha,'rendererSHA256':renderer,
                          'image':str(path.relative_to(BASE)),
                          'imageSHA256':hashlib.sha256(path.read_bytes()).hexdigest(),
                          'renderedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat()}
            print('DETAIL RENDERED',key,flush=True)
        except Exception as error:
            traceback.print_exc()
            records[key]={'sha256':sha,'status':'failed','error':str(error)}
            failed.append(key)
        # Separate family refinements can render while the full pass runs.
        # Merge under a stable lock and publish atomically to retain both jobs.
        with (OUTPUT/'render-manifest.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            latest=json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
            latest[key]=records[key]
            temporary=OUTPUT/f'render-manifest.{os.getpid()}.tmp'
            temporary.write_text(json.dumps(latest,indent=2)+'\n')
            temporary.replace(MANIFEST)
            fcntl.flock(lock,fcntl.LOCK_UN)
print('DETAIL PASS DONE',len(selectors),'assets;',len(failed),'failed',flush=True)
if failed:raise RuntimeError('Failed views: '+', '.join(failed))
