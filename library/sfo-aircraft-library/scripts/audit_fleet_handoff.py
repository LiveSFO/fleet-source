"""Inventory selected handoff files and their local license evidence.

This records upstream notices; it does not grant a license or resolve every
cross-source compatibility question. Include corresponding source on handoff.
"""
from pathlib import Path
import datetime, hashlib, json, re

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'assets/airliners'
cfg=json.loads((BASE/'fleet-build-config.json').read_text())
coverage=json.loads((BASE/'sfo-build-coverage.json').read_text())
selectors=sorted({row['asset']['aircraft']+'/'+row['asset']['livery']
                  for row in coverage['combinations'] if row['asset']})

def strings(value):
    if isinstance(value,str):yield value
    elif isinstance(value,dict):
        for child in value.values():yield from strings(child)
    elif isinstance(value,list):
        for child in value:yield from strings(child)

def source_packages(family,livery,seen=None):
    seen=set() if seen is None else seen
    if family in seen:return set()
    seen.add(family)
    model=cfg.get(family,{})
    paint=next((l for l in model.get('liveries',[]) if l['id']==livery),{})
    data={**model,'liveries':[paint]}
    result=set()
    for value in strings(data):
        match=re.match(r'@?(preparation/[^/]+)(?:/|$)',value)
        if match and (BASE/match[1]/'upstream').is_dir():result.add(match[1])
        match=re.match(r'([^/]+)/([^/]+)\.blend$',value)
        if match:result.update(source_packages(*match.groups(),seen))
    if family=='b738':result.add('b738')
    return result

packages={}
assets=[]
for selector in selectors:
    family,livery=selector.split('/')
    source=source_packages(family,livery)
    for package in sorted(source):
        if package in packages:continue
        folder=BASE/package
        upstream=folder/'upstream'
        notices=[f for f in upstream.iterdir() if f.is_file() and
                 any(word in f.name.lower() for word in ['licen','licenc','copying','readme','thanks','author'])]
        terms='\n'.join(f.read_text(errors='replace') for f in notices)
        if 'Attribution-NonCommercial-ShareAlike 3.0' in terms:license_text='CC BY-NC-SA 3.0'
        elif re.search(r'Version 3,\s*29 June 2007',terms):license_text='GPL version 3 text; see file-specific grants'
        elif 'GNU General Public License' in terms or 'GNU GENERAL PUBLIC LICENSE' in terms:license_text='GPL version 2 text / version 2 or later grants; inspect exact notices'
        else:license_text='Inspect preserved upstream notices'
        repo=folder/'repository.json'
        packages[package]={
            'repository':json.loads(repo.read_text()) if repo.exists() else None,
            'licenseEvidence':license_text,
            'noncommercialRestriction':'CC BY-NC-SA' in license_text,
            'notices':[str(f.relative_to(BASE)) for f in sorted(notices)],
            'correspondingSource':str(upstream.relative_to(BASE)),
            'downloadManifest':str((folder/'download-manifest.json').relative_to(BASE)) if (folder/'download-manifest.json').exists() else None,
        }
    glb=BASE/family/'exports'/f'{livery}.glb'
    rig=glb.with_suffix('.rig.json')
    lights=BASE/family/'lights.json'
    scene=BASE/family/f'{livery}.blend'
    assert all(p.exists() for p in [glb,rig,lights,scene]),selector
    assets.append({
        'selector':selector,
        'glb':str(glb.relative_to(BASE)),
        'sha256':hashlib.sha256(glb.read_bytes()).hexdigest(),
        'rig':str(rig.relative_to(BASE)),
        'lights':str(lights.relative_to(BASE)),
        'editableScene':str(scene.relative_to(BASE)),
        'sourcePackages':sorted(source),
        'authoredGeometry':cfg.get(family,{}).get('format')=='reference-loft',
        'reuseNote':'Noncommercial share-alike source; do not include in a commercial asset handoff without a separate permission basis.' if any(packages[p]['noncommercialRestriction'] for p in source) else 'Preserve the exact source notices and corresponding source. Original additions and airline marks do not create blanket third-party clearance.',
    })

report={
    'updatedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scope':'Current selected SFO exports only. License evidence inventory, not a legal clearance certificate.',
    'runtimeFiles':['viewer/airliner-runtime.js','viewer/fleet-catalog.js'],
    'buildSource':['scripts/','assets/airliners/fleet-build-config.json','assets/airliners/reference-jet-profiles.json'],
    'excludedCandidate':'Headwind A330neo exterior was not converted: its model-specific exception requires creator permission. Do not include the unused preparation/aircraft candidate in a portable handoff.',
    'mixedLicenseNote':'Some assemblies combine separately licensed geometry and paint. Retain all notices and verify the exact file-level grants and their compatibility before redistribution; a GPL version number in a license copy is not a substitute for that review.',
    'artworkMetadata':[str(p.relative_to(BASE)) for p in sorted((BASE/'preparation/brand-art').glob('*.asset.json'))],
    'counts':{'combinations':len(coverage['combinations']),'exports':len(assets),'airframes':len({a['selector'].split('/')[0] for a in assets})},
    'sourcePackages':packages,
    'assets':assets,
}
(BASE/'asset-handoff-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
print(report['counts'])
