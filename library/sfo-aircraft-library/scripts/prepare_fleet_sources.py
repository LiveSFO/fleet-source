"""Stage pinned exterior data and audit it before conversion. Never runs upstream code.
This is an intake report, not a claim of renderer/animation readiness.
"""
import pathlib,json,urllib.request,urllib.parse,concurrent.futures,hashlib,xml.etree.ElementTree as ET,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from ac3d_data import read_ac
BASE=pathlib.Path(__file__).resolve().parents[1]/'assets/airliners/preparation'
CONFIG={
 'E-jet-family':{'geometry':['Models/erj175.ac'],'xml':['XMLs/ERJ-175-Model.xml','XMLs/ERJ-175.xml','Embraer175-set.xml'],'liveries':['Models/Liveries/ERJ175/'+n+ext for n in ['UnitedExpress','Delta','AirCanada'] for ext in ['.png']]},
 '787':{'geometry':['Models/787-8.ac'],'xml':['Models/787.xml','787-set.xml'],'liveries':['Models/Liveries/'+n+ext for n in ['UAL','ANA','JAL'] for ext in ['.xml','.png','-lights.png']]},
 '777':{'geometry':['Models/777-300ER.ac','Models/777-200LR.ac'],'xml':['Models/777-300ER.xml','Models/777-200F.xml','777-200F-set.xml'],'liveries':['Models/Liveries-F/FDX.xml','Models/Liveries-F/FDX.png','Models/Liveries-300/ANA.xml','Models/Liveries-300/ANA.png','Models/Liveries-300/JAL.xml','Models/Liveries-300/JAL.png'],'hold':'No unambiguous root exterior license located. Do not publish converted assets pending provenance review.'},
 '767-300':{'geometry':['Models/767-300.ac','Models/passengerdoor.ac','Models/cargodoor.ac','Models/winglets.ac'],'xml':['Models/767-300.xml','767-300ER-set.xml'],'liveries':['Models/Liveries/UAL.xml','Models/Liveries/UAL.png'],'hold':'Source is a passenger 767-300. A freighter requires its own door, window deletion and variant geometry; no freighter claimed.'},
 'CitationX':{'geometry':['Models/CitationX.ac'],'xml':['Models/Citation-X.xml','CitationX-set.xml'],'liveries':[]},
 'c172p':{'geometry':['Models/c172-common.ac'],'xml':['Models/c172p.xml','c172p-set.xml'],'liveries':[]},
 'ec135':{'geometry':['Models/ec135.ac','Models/rotors/mainrotor.ac'],'xml':['Models/ec135.xml','ec135p2-set.xml'],'liveries':[],'hold':'EC135 P2 source candidate only; Bay Area operator/variant/livery match must be established before portraying a local service.'},
}
def download(folder,entry):
 info=json.loads((folder/'repository.json').read_text());tree=json.loads((folder/'repository-tree.json').read_text());path=entry['path'];p=folder/'upstream'/path;p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists():data=p.read_bytes()
 else:
  url='https://raw.githubusercontent.com/'+info['full_name']+'/'+tree['sha']+'/'+urllib.parse.quote(path)
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Prop-workshop-source-evaluation'}),timeout=90) as response:data=response.read()
  p.write_bytes(data)
 blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
 if blob!=entry['sha']:raise ValueError('Git blob mismatch: '+path)
 return {'path':path,'gitBlob':blob,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
reports=[]
for family,cfg in CONFIG.items():
 folder=BASE/family;tree=json.loads((folder/'repository-tree.json').read_text());entries={q['path']:q for q in tree['tree'] if q['type']=='blob'};info=json.loads((folder/'repository.json').read_text())
 legal=[p for p in entries if '/' not in p and (any(s in p.lower() for s in ['licen','licenc','copying','author','thanks']) or p.lower().startswith('readme'))]
 paths=list(dict.fromkeys(cfg['geometry']+cfg['xml']+legal+[p for p in cfg['liveries'] if p in entries]));manifest=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:manifest.extend(pool.map(lambda p:download(folder,entries[p]),paths))
 models=[];textures=set()
 for rel in cfg['geometry']:
  materials,world=read_ac(folder/'upstream'/rel);counts={'objects':0,'vertices':0,'estimatedTriangles':0};names=[]
  def visit(o):
   if o['faces']:
    counts['objects']+=1;counts['vertices']+=len(o['verts']);counts['estimatedTriangles']+=sum(max(0,len(f['v'])-2) for f in o['faces']);names.append(o['name'])
   if o['texture']:
    p=(pathlib.PurePosixPath(rel).parent/o['texture']).as_posix()
    if p in entries:textures.add(p)
    else:
     matches=[p for p in entries if pathlib.PurePosixPath(p).name==pathlib.PurePosixPath(o['texture']).name]
     if len(matches)==1:textures.add(matches[0])
   for c in o['children']:visit(c)
  visit(world);models.append({'path':rel,**counts,'partNames':names})
 # Include root-level exterior texture maps, since XML effects can override AC paths.
 textures.update(p for p in entries if p.startswith('Models/') and p.count('/')==1 and p.endswith(('.png','.rgb')) and not any(s in p.lower() for s in ['panel','flightdeck','glareshield','console','interior','revetement','cabin','seat','floor','wall','lettering','digits','radio','trim','ceiling']))
 # Avoid fetching every 767 airline map; preserve neutral surfaces and selected United paint.
 if family=='767-300':textures={p for p in textures if pathlib.PurePosixPath(p).name in ['Gear.png','Wings.png','chrome.png','glass_shader.png','shadow.png','template.png'] or p in {m['path'] for m in manifest}}
 textures-=set(paths)
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:manifest.extend(pool.map(lambda p:download(folder,entries[p]),sorted(textures)))
 anim={};properties=set()
 for rel in cfg['xml']:
  try:x=ET.parse(folder/'upstream'/rel).getroot()
  except ET.ParseError:continue
  for a in x.iter('animation'):
   k=a.findtext('type','group');anim[k]=anim.get(k,0)+1
   if a.findtext('property'):properties.add(a.findtext('property'))
 report={'family':family,'repository':info['html_url'],'revision':tree['sha'],'status':'source-staged-not-converted','readyForScene':False,'licenseMetadata':info.get('license'),'legalFiles':legal,'notes':cfg.get('hold','Needs manufacturer-dimension, exact variant, texture and animation review before release.'),'downloadedFiles':len(manifest),'downloadedBytes':sum(m['bytes'] for m in manifest),'geometry':models,'animationTypes':anim,'properties':sorted(properties),'liveryFiles':[p for p in cfg['liveries'] if p in entries]}
 (folder/'download-manifest.json').write_text(json.dumps(manifest,indent=2));(folder/'intake-report.json').write_text(json.dumps(report,indent=2));reports.append(report)
 print(family,report['downloadedFiles'],report['downloadedBytes'],sum(m['estimatedTriangles'] for m in models),'estimated tris',flush=True)
(BASE/'intake-summary.json').write_text(json.dumps(reports,indent=2))
