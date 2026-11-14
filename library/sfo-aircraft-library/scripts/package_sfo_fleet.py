"""Portable captured-fleet library with corresponding selected source data.

No manufacturer reference PDFs or unused permission-restricted candidates are
redistributed. Run after the hash-bound coverage and handoff audits.
"""
from pathlib import Path
import datetime,hashlib,json,zipfile
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'assets/airliners'
manifest=json.loads((BASE/'asset-handoff-manifest.json').read_text())
files={};prefix=Path('sfo-aircraft-library')
def digest(path):
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def add(path):
 if path.is_file() and not any(p.startswith('.') for p in path.relative_to(ROOT).parts):
  files[str(path.relative_to(ROOT))]=path

def tree(folder):
 for path in folder.rglob('*'):
  if '__pycache__' not in path.parts and path.suffix not in ['.blend1','.pyc','.pdf']:add(path)

selected={a['selector'] for a in manifest['assets']}
legacy={'a320neo/british-airways','a320neo/sas','a320neo/lufthansa','b738/ryanair','b738/united'}
all_selectors=selected|legacy
for selector in sorted(all_selectors):
 family,livery=selector.split('/')
 for path in [BASE/family/'exports'/(livery+'.glb'),BASE/family/'exports'/(livery+'.rig.json'),
              BASE/family/'exports'/(livery+'.validation.json'),BASE/family/'lights.json',BASE/family/(livery+'.blend')]:
  if not path.exists():raise FileNotFoundError(path)
  add(path)
for package in sorted(set(manifest['sourcePackages'])|{'a320neo','b738'}):
 folder=BASE/package
 if package in ['a320neo','b738']:
  tree(folder/'upstream')
 else:tree(folder)
# Editable donor scenes and generated masks/paint maps are corresponding build
# inputs even when the donor is not one of the captured inventory selectors.
for path in BASE.glob('*/*.blend'):add(path)
for folder in BASE.glob('*/generated'):tree(folder)
tree(BASE/'preparation/brand-art')
for name in ['README.md','fleet-build-config.json','reference-jet-profiles.json','sfo-build-coverage.json',
             'asset-handoff-manifest.json','visual-reviews.json','fleet-validation-summary.json',
             'validation-summary.json','fleet-catalog.json']:
 add(BASE/name)
for path in (BASE/'traffic').glob('*.json'):add(path)
for path in (BASE/'previews/detail-pass').glob('fleet-detail-*.jpg'):add(path)
add(BASE/'previews/detail-pass/sheet-index.json')
for name in ['airliners.html','airliners.css','airliners.js','airliner-runtime.js','fleet-catalog.js']:add(ROOT/'viewer'/name)
for path in (ROOT/'scripts').iterdir():
 if path.suffix in ['.py','.mjs']:add(path)

catalog={}
config=json.loads((BASE/'fleet-build-config.json').read_text())
for selector in sorted(all_selectors):
 family,livery=selector.split('/')
 if family in config:
  model=config[family];name=next(l['name'] for l in model['liveries'] if l['id']==livery)
  catalog.setdefault(family,{'name':model['label'],'liveries':[]})['liveries'].append([livery,name])
package={'name':'sfo-aircraft-library','private':True,'type':'module',
         'scripts':{'start':'node scripts/serve.mjs'},
         'dependencies':{'three':'0.186.1','gltf-validator':'2.0.0-dev.3.10'}}
readme='''# Captured SFO aircraft library\n\n142 captured November 11, 2026 aircraft/operator/paint combinations map to 138 selected exports across 62 airframe entries. Five additional legacy exports support the original viewer defaults. All selected exports have automated checks and eight-view review evidence; several private-aircraft shapes, source-era liveries and helicopter variants remain representative studies. This is not a claim to include every actual SFO movement or factory-exact geometry.\n\nRun `npm install`, then `npm start`; open http://127.0.0.1:8080/viewer/airliners.html. To reuse one aircraft, copy its GLB, matching .rig.json and lights.json with the same folder layout, and viewer/airliner-runtime.js plus viewer/fleet-catalog.js. GLBs pack their textures and native geometry-animation clips. The runtime supplies light fixtures, flash timing and switchable cabin illumination. Units: metres; Y up, X aft, Z port.\n\nSee assets/airliners/README.md for the integration example and modelling notes. asset-handoff-manifest.json maps every captured export to its source and license records. GPL and other upstream notices accompany the selected corresponding source, build scripts, generated maps and editable scenes. This library has mixed source terms; King Air B200/C90 sources are noncommercial share-alike. Retain each applicable notice and source; the bundle provides no blanket commercial clearance.\n\nThe contact sheets are included. Individual high-resolution review PNGs remain in the original workspace and are not included to limit bundle size. Their hashes and paths are retained in the review evidence. Manufacturer brochures/planning PDFs and unused candidate models are excluded. The pinned source packages and build input files are retained; regeneration may additionally require Blender, Python dependencies and the referenced source/reference downloads.\n'''
generated={
 'README.md':readme,
 'package.json':json.dumps(package,indent=2)+'\n',
 'viewer/fleet-catalog.js':'export const fleetCatalog='+json.dumps(catalog,indent=2)+';\n',
 'viewer/airliners.html':(ROOT/'viewer/airliners.html').read_text(),  # (published copy: a replace of links to unrelated pages left out)
}
for name in generated:files.pop(name,None)
metadata={'createdAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'counts':{'capturedCombinations':142,'selectedExports':len(selected),'airframes':62,'legacyExtras':len(legacy)},
          'selectedExports':sorted(selected),'legacyExtras':sorted(legacy),
          'omitted':['Manufacturer reference PDFs','Unused source candidates','Individual review PNGs','node_modules'],
          'files':{name:{'bytes':path.stat().st_size,'sha256':digest(path)} for name,path in sorted(files.items()) if name not in generated}}
metadata['files'].update({name:{'bytes':len(value.encode()),'sha256':hashlib.sha256(value.encode()).hexdigest()} for name,value in generated.items()})
archive=ROOT/'releases/sfo-fleet-2026-11-11.zip';archive.parent.mkdir(exist_ok=True)
temporary=archive.with_suffix('.partial.zip')
with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED,compresslevel=3,allowZip64=True) as z:
 for number,(name,path) in enumerate(sorted(files.items()),1):
  if name not in generated:z.write(path,prefix/name)
  if number%250==0:print('Packaged',number,'of',len(files),'files',flush=True)
 for name,value in generated.items():z.writestr(str(prefix/name),value)
 z.writestr(str(prefix/'PACKAGE-MANIFEST.json'),json.dumps(metadata,indent=2)+'\n')
# Verify every stream CRC before publishing the final archive.
with zipfile.ZipFile(temporary) as z:
 bad=z.testzip()
 if bad:raise ValueError('ZIP integrity failure: '+bad)
temporary.replace(archive)
summary={'archive':str(archive.relative_to(ROOT)),'bytes':archive.stat().st_size,
         'sha256':digest(archive),'counts':metadata['counts'],
         'crcVerified':True,'sourceAndEditableScenesIncluded':True}
archive.with_suffix('.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary),flush=True)
