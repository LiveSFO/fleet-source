"""Package nine assets, complete selected source data, runtime and local viewer."""
import pathlib,shutil,zipfile,json
root=pathlib.Path(__file__).resolve().parents[1];dest=root/'releases/airliners';dest.mkdir(parents=True,exist_ok=True)
for key in ['a320neo','b738']:
 source=root/'assets/airliners'/key;target=dest/'assets/airliners'/key
 for directory in ['upstream','generated','exports']:
  shutil.copytree(source/directory,target/directory,dirs_exist_ok=True)
 shutil.copy2(source/'lights.json',target/'lights.json')
 for blend in source.glob('*.blend'):shutil.copy2(blend,target/blend.name)
for name in ['README.md','validation-summary.json','fleet-catalog.json']:
 p=dest/'assets/airliners'/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/'assets/airliners'/name,p)
# Candidate metadata is useful for handoff; unreviewed meshes and manufacturer
# PDFs stay out of the portable production release.
prep=root/'assets/airliners/preparation'
for source in prep.rglob('*.json'):
 target=dest/'assets/airliners/preparation'/source.relative_to(prep);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
shutil.copy2(prep/'README.md',dest/'assets/airliners/preparation/README.md')
for name in ['airliners.html','airliners.css','airliners.js','airliner-runtime.js']:
 p=dest/'viewer'/name;p.parent.mkdir(exist_ok=True);shutil.copy2(root/'viewer'/name,p)
# (Published copy: a line that removed the viewer page's links to unrelated pages is left out. It doesn't touch the models.)
scripts=['serve.mjs','ac3d_data.py','prepare_airliners.py','bake_airliner_animations.mjs','normalize_airliner_pngs.py','validate_airliners.mjs','create_airliner_window_mask.py','refine_southwest_palette.py','fetch_aircraft_sources.py','package_airliners.py','prepare_fleet_sources.py']
for name in scripts:
 p=dest/'scripts'/name;p.parent.mkdir(exist_ok=True);shutil.copy2(root/'scripts'/name,p)
(dest/'package.json').write_text(json.dumps({'name':'animated-airliner-library','private':True,'type':'module','scripts':{'start':'node scripts/serve.mjs','validate':'node scripts/validate_airliners.mjs','validate:airliners':'node scripts/validate_airliners.mjs','build:airliners':'"/Applications/Blender.app/Contents/MacOS/Blender" --background --python scripts/prepare_airliners.py && node scripts/bake_airliner_animations.mjs && python3 scripts/normalize_airliner_pngs.py'},'dependencies':{'three':'0.186.1','gltf-validator':'2.0.0-dev.3.10'}},indent=2))
(dest/'README.md').write_text('''# Animated airliner library

Nine animated GLBs: Airbus A320neo in British Airways/SAS/Lufthansa liveries; Boeing 737-800 in Ryanair/Southwest/American/Alaska/Delta/United globe-era liveries. United artwork depicts the historical Continental globe era, not the current Evo-Blue paint.

For a web project, copy `assets/airliners` plus `viewer/airliner-runtime.js`. The loader supplies exterior lights, flash timing and switchable cabin windows. Each GLB also contains standard Gear, Flaps, Reversers, Spoilers and Fans geometry-animation clips. Units are meters, Y up, X aft, Z port.

For a local preview:

```sh
npm install
npm start
```

Open http://127.0.0.1:8080/viewer/airliners.html. If port 8080 is occupied, run `PORT=8081 npm start` and use that port instead.

See `assets/airliners/README.md` for the API example, dimension checks, sources, modifications and known fidelity limits. The upstream selected exterior source meshes/XML/textures and license notices are included alongside each aircraft. Editable Blender scenes are included too. The SFO fleet catalog and seven next-batch source intake reports/manifests are included for handoff; unconverted candidate meshes and manufacturer PDFs are not included. These are detailed adaptations of FlightGear assets; preserve their GPL-2.0 notices and corresponding source when redistributing adapted asset files. Manufacturer reference PDFs are linked in the notes and are not included in this package.
''')
preview=root/'assets/airliners/previews'
if preview.exists():shutil.copytree(preview,dest/'previews',dirs_exist_ok=True)
archive=root/'releases/airliners.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted(dest.rglob('*')):
  if p.is_file():z.write(p,pathlib.Path('airliners')/p.relative_to(dest))
print(json.dumps({'bundle':str(archive),'bytes':archive.stat().st_size},indent=2))
