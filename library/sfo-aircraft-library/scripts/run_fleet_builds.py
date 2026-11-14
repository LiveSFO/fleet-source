"""Build configured aircraft families sequentially and retain actionable failures."""
import pathlib,json,subprocess,sys,time
root=pathlib.Path(__file__).resolve().parents[1];base=root/'assets/airliners';cfg=json.loads((base/'fleet-build-config.json').read_text());logdir=base/'build-logs';logdir.mkdir(exist_ok=True);progress=base/'build-progress.json';report=json.loads(progress.read_text()) if progress.exists() else []
keys=sys.argv[1:] or list(cfg)
for key in keys:
 logfile=logdir/(key+'.log');start=time.time()
 with logfile.open('w') as f:
  result=subprocess.run(['/Applications/Blender.app/Contents/MacOS/Blender','--background','--python-exit-code','1','--python',str(root/'scripts/build_fleet_aircraft.py'),'--',key],cwd=root,stdout=f,stderr=subprocess.STDOUT)
 logs=logfile.read_text(errors='replace');row={'aircraft':key,'status':'built-awaiting-checks' if result.returncode==0 else 'build-failed','seconds':round(time.time()-start,1),'log':str(logfile.relative_to(base)),'expectedLiveries':[x['id'] for x in cfg[key]['liveries']]}
 if result.returncode:row['error']='\n'.join(logs.splitlines()[-18:])
 report=[r for r in report if r['aircraft']!=key];report.append(row);(base/'build-progress.json').write_text(json.dumps(report,indent=2));print(json.dumps(row),flush=True)
