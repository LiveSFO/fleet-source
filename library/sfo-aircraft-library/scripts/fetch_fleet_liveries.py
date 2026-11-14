"""Download pinned image dependencies named by selected livery XML files."""
import pathlib,json,sys,xml.etree.ElementTree as ET,urllib.request,urllib.parse,concurrent.futures,hashlib,posixpath
BASE=pathlib.Path(__file__).resolve().parents[1]/'assets/airliners'
config=json.loads((BASE/'fleet-build-config.json').read_text());jobs={}
for key,cfg in config.items():
 if sys.argv[1:] and key not in sys.argv[1:]:continue
 if cfg.get('format')=='reference-loft':continue
 folder=BASE/cfg['source'];up=folder/'upstream';meta=json.loads((folder/'repository.json').read_text());tree=json.loads((folder/'repository-tree.json').read_text());files={q['path']:q for q in tree['tree'] if q['type']=='blob'}
 for liv in cfg['liveries']:
  paths=set(liv.get('textures',{}).values())
  if liv.get('xml') and not liv['xml'].startswith('@') and not pathlib.Path(liv['xml']).is_absolute():
   xml=up/liv['xml']
   for e in ET.parse(xml).getroot().iter():
    if e.text and e.text.strip().lower().endswith(('.png','.jpg','.rgb')):
     tex=e.text.strip().replace('\\','/').lstrip('/');candidates=[posixpath.normpath(str(pathlib.PurePosixPath(liv['xml']).parent/tex)),'Models/'+tex,tex]
     if 'Aircraft/' in tex:candidates+=['/'.join(tex.split('/')[2:])]
     if cfg.get('sourcePackage'):candidates+=[cfg['sourcePackage']+'/Models/'+tex,cfg['sourcePackage']+'/'+tex]
     found=next((p for p in candidates if p in files),None)
     if not found:
      matches=[p for p in files if pathlib.PurePosixPath(p).name.lower()==pathlib.PurePosixPath(tex).name.lower()]
      if len(matches)==1:found=matches[0]
     if found:paths.add(found)
     else:
      if 'light' in tex.lower():print('Source lighting-map reference missing; generated cabin mask required:',tex,flush=True)
      else:raise ValueError('Livery texture not in pinned tree: '+str(xml)+' -> '+tex)
  for path in paths:
   if path not in files:raise ValueError('Unknown pinned texture '+path)
   q=files[path];jobs[(str(folder),path)]=(folder,path,q,meta['full_name'],tree['sha'])
def get(job):
 folder,path,entry,repo,sha=job;p=folder/'upstream'/path;p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists():data=p.read_bytes()
 else:
  url='https://raw.githubusercontent.com/'+repo+'/'+sha+'/'+urllib.parse.quote(path)
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Prop-workshop-source-evaluation'}),timeout=100) as r:data=r.read()
  p.write_bytes(data)
 blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
 if blob!=entry['sha']:raise ValueError('Pinned blob mismatch: '+path)
 return folder,{'path':path,'gitBlob':blob,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
by_folder={}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for folder,result in pool.map(get,jobs.values()):by_folder.setdefault(folder,[]).append(result)
for folder,rows in by_folder.items():
 p=folder/'download-manifest.json';existing={q['path']:q for q in json.loads(p.read_text())} if p.exists() else {};existing.update({q['path']:q for q in rows});p.write_text(json.dumps(list(existing.values()),indent=2));print(folder.name,len(rows),'livery image files verified',flush=True)
