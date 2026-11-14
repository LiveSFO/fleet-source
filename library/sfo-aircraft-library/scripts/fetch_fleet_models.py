"""Fetch selected pinned FlightGear exterior data. Does not execute upstream code."""
import pathlib,json,urllib.request,urllib.parse,concurrent.futures,hashlib,shlex,re,sys
BASE=pathlib.Path(__file__).resolve().parents[1]/'assets/airliners/preparation'
PLANS={
 'A320Family-modern':['Models/Fuselages/','Models/Engines/','Models/LandingGears/','Models/Wings/'],
 '767-300-modern':['Models/767-300.ac','Models/cargodoor.ac','Models/passengerdoor.ac','Models/winglets.ac'],
 '787-family':['Models/787-8.ac','Models/787-9.ac','Models/787-10.ac','Models/GEnx.ac','Models/Trent1000.ac'],
 'CSeries-modern':['Models/CS100.ac','Models/CS300.ac'],
 '737-Next-Generation':['Models/737-800.ac','Models/737-700.ac','Models/737-900.ac','Models/LWing.ac','Models/RWing.ac','Models/HorzStab.ac','Models/VertStab.ac','Models/nosegear.ac','Models/winglet2.ac'],
 '737-MAX':['Models/737-8.ac','Models/737-9.ac'],
 'Boeing-777-Flightgear':['777-VMD/Models/Liveries-200ER/777-200.ac','777-VMD/Models/Liveries-300ER/777-300.ac','777-VMD/Models/Liveries-F/777-200F.ac'],
 'A319':['Models/a319-ph2.ac'],
 'A321':['Models/a321-231.ac','Models/a321.ac','Models/Engine/cfm56.ac','Models/Engine/v2500.ac'],
 'A320neo':['Models/Fuselages/','Models/Engines/','Models/LandingGears/','Models/Wings/'],
 'IDG-A32X':['Models/Fuselages/','Models/Engines/','Models/LandingGears/','Models/Wings/'],
 'IDG-A33X':['Models/a330-200-main.ac','Models/a330-300-main.ac','Models/cf6-80e1.ac','Models/cf6-80e1a3.ac','Models/pw4000.ac','Models/trent772b-60.ac','Models/trent772c-60.ac'],
 'A350XWB':['Models/A350XWB-900.ac'],
 'A380-omega':['Models/a380.ac','Models/trent900.ac'],
 '747-8i':['Models/747-8F.ac','Models/747-8i.ac','Models/747-8i_gear.ac'],
 '747-400':['Models/747-400_fuselage.ac','Models/747-400_wings.ac','Models/747-400_gear.ac','Models/GE_CF6-80C2B1F.ac'],
 '757-200':['Models/757-200.ac','Models/757-300.ac','Models/757-200PWengines.ac','Models/757-200RB211engines.ac','Models/winglets.ac'],
 '787-9':['Models/787-9.ac'],
 'CRJ700-family':['Models/CRJ900.ac','Models/CRJ700-engine.ac','Models/CRJ700-maingear.ac','Models/CRJ700-nosegear.ac'],
 'CRJ200':['Models/crj-200.ac'],
 'CSeries':['Models/CS100.ac','Models/CS300.ac'],
 'E-jet-family-YV':['Models/erj175.ac'],
}
SKIP=re.compile(r'/(Cockpit|FlightDeck|Instruments?|Ground|Services?|Operations?|Autopush|Pushback|Human|People|Panel|Primus-Epic|OHpanel|EFB)/',re.I)
def fetch(folder,p):
 meta=json.loads((folder/'repository.json').read_text());tree=json.loads((folder/'repository-tree.json').read_text());entries={q['path']:q for q in tree['tree'] if q['type']=='blob'};q=entries[p];out=folder/'upstream'/p;out.parent.mkdir(parents=True,exist_ok=True)
 if out.exists():b=out.read_bytes()
 else:
  url='https://raw.githubusercontent.com/'+meta['full_name']+'/'+tree['sha']+'/'+urllib.parse.quote(p)
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Prop-workshop-source-evaluation'}),timeout=100) as r:b=r.read()
  out.write_bytes(b)
 blob=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if blob!=q['sha']:raise ValueError('Git blob verification failed: '+p)
 return {'path':p,'gitBlob':blob,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def main():
 args=sys.argv[1:]
 for family,patterns in PLANS.items():
  if args and family not in args:continue
  folder=BASE/family
  if not (folder/'repository-tree.json').exists():continue
  tree=json.loads((folder/'repository-tree.json').read_text());files={q['path']:q for q in tree['tree'] if q['type']=='blob'}
  legal=[p for p in files if p.count('/')==0 and any(s in p.lower() for s in ['licen','licenc','copying','readme','author','thank'])]
  xml=[p for p in files if p.endswith('.xml') and not SKIP.search('/'+p) and ('Models/' in p or '/' not in p)]
  geom=[p for p in files if p.endswith('.ac') and (any(p==q or (q.endswith('/') and p.startswith(q)) for q in patterns) or pathlib.PurePosixPath(p).name.lower() in ['empty.ac','null.ac'])]
  paths=list(dict.fromkeys(legal+xml+geom));manifest=[]
  with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:manifest.extend(pool.map(lambda p:fetch(folder,p),paths))
  textures=set()
  for rel in geom:
   text=(folder/'upstream'/rel).read_text(errors='replace')
   for line in text.splitlines():
    if not line.startswith('texture '):continue
    tex=shlex.split(line)[1];p=(pathlib.PurePosixPath(rel).parent/tex).as_posix()
    if p in files:textures.add(p)
    else:
     matches=[p for p in files if pathlib.PurePosixPath(p).name==pathlib.PurePosixPath(tex).name]
     # Preserve every colliding neutral map; conversion chooses by source path.
     textures.update(matches)
  with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:manifest.extend(pool.map(lambda p:fetch(folder,p),sorted(textures-set(paths))))
  (folder/'download-manifest.json').write_text(json.dumps(manifest,indent=2))
  print(family,'files',len(manifest),'geometry',len(geom),'MB',round(sum(q['bytes'] for q in manifest)/1e6,2),'legal',legal,flush=True)

if __name__=='__main__':main()
