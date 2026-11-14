"""Fetch pinned repaint data and its image dependencies; never execute source code."""
import sys,pathlib,json,xml.etree.ElementTree as ET,concurrent.futures
from fetch_fleet_models import fetch
BASE=pathlib.Path(__file__).resolve().parents[1]/'assets/airliners/preparation'
def stage(source,prefixes):
 folder=BASE/source;tree=json.loads((folder/'repository-tree.json').read_text())['tree'];files=[x['path'] for x in tree if x['type']=='blob'];paths={p for p in files if any(p.startswith(q) for q in prefixes) and pathlib.Path(p).suffix.lower() in ['.xml','.png','.jpg','.jpeg','.rgb']}
 paths.update(p for p in files if '/' not in p and any(w in p.lower() for w in ['licen','copying','readme','author']))
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:manifest=list(pool.map(lambda p:fetch(folder,p),sorted(paths)))
 dependencies=set()
 for rel in paths:
  if not rel.endswith('.xml'):continue
  for node in ET.parse(folder/'upstream'/rel).iter():
   value=(node.text or '').strip()
   if pathlib.Path(value).suffix.lower() not in ['.png','.jpg','.jpeg','.rgb']:continue
   candidates=[p for p in files if pathlib.Path(p).name.lower()==pathlib.Path(value).name.lower()]
   if candidates:
    # Prefer the image sharing the longest directory prefix with its XML.
    scores=lambda p:len(pathlib.Path(pathlib.os.path.commonpath([p,rel])).parts)
    best=max(map(scores,candidates));dependencies.update(p for p in candidates if scores(p)==best)
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:manifest+=list(pool.map(lambda p:fetch(folder,p),sorted(dependencies-paths)))
 old=json.loads((folder/'download-manifest.json').read_text()) if (folder/'download-manifest.json').exists() else []
 (folder/'download-manifest.json').write_text(json.dumps(list({x['path']:x for x in old+manifest}.values()),indent=2));print(source,'verified',len(manifest),'files',flush=True)
if __name__=='__main__':stage(sys.argv[1],sys.argv[2:])
