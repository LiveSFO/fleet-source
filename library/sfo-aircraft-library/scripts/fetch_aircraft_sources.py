"""Download pinned, selected aircraft data only; no upstream code is executed."""
import pathlib,json,urllib.request,urllib.parse,concurrent.futures,time,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[1]/'assets/airliners'
jobs=[]
for key,repo,treefile in [('a320neo','legoboyvdlp/A320-family','/tmp/a320-tree.json'),('b738','YV3399/737-800YV','/tmp/737yv-tree.json')]:
 dest=ROOT/key/'upstream';dest.mkdir(parents=True,exist_ok=True)
 pinned=dest/'repository-tree.json';tree=json.loads(pinned.read_text()) if pinned.exists() else json.load(open(treefile));sha=tree['sha']
 pinned.write_text(json.dumps(tree))
 (dest/'upstream-revision.json').write_text(json.dumps({'repository':repo,'revision':sha,'retrieved':'2026-11-11'},indent=2))
 selected=[]
 for q in tree['tree']:
  p=q['path']
  if q['type']!='blob':continue
  keep=p in ['LICENSE','README.md','README.copyright.md','THANKS']
  if key=='a320neo':keep|=p.startswith(('Models/Fuselage/','Models/Lights/','Models/Liveries/CFM-NEO/','Models/Liveries/PW-NEO/')) or (p.startswith('Models/') and p.count('/')==1 and p.endswith('.xml'))
  else:keep|=(p.startswith('Models/') and p.count('/')==1 and p.endswith(('.ac','.png','.xml'))) or p.startswith('Models/lights/') or (p.startswith('Models/Liveries-800/') and pathlib.Path(p).stem in ['AAL','SWA-new','RYR','UAL','ASA2','DAL'])
  if keep:
   selected.append({'path':p,'gitBlob':q['sha'],'bytes':q.get('size')})
   jobs.append(('https://raw.githubusercontent.com/'+repo+'/'+sha+'/'+urllib.parse.quote(p),dest/p))
 (dest/'download-manifest.json').write_text(json.dumps(selected,indent=2))
refs=ROOT/'reference';refs.mkdir(parents=True,exist_ok=True)
jobs += [('https://mediaassets.airbus.com/pm_38_916_916266-iujedqawwy.pdf?fileName=aca32001-jul-2026-2.pdf',refs/'Airbus-A320-AC-2026-07.pdf'),('https://www.boeing.com/content/dam/boeing/v2/airports/acaps/737NG_REV_C.pdf',refs/'Boeing-737NG-AC-RevC.pdf')]
def fetch(job):
 url,p=job;p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists() and p.stat().st_size>0:return str(p.relative_to(ROOT))+' cached'
 for attempt in range(3):
  try:
   req=urllib.request.Request(url,headers={'User-Agent':'Prop-workshop-source-evaluation'})
   with urllib.request.urlopen(req,timeout=90) as r:data=r.read()
   p.write_bytes(data)
   return str(p.relative_to(ROOT))+' '+str(len(data))
  except Exception:
   if attempt==2:raise
   time.sleep(1)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for result in pool.map(fetch,jobs):print(result,flush=True)
print('Finished',len(jobs),'source files',flush=True)
