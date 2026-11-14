"""Fetch explicitly selected public-domain brand vectors and retain license metadata.
Rejects unknown/non-PD licenses rather than treating a public URL as a grant.
"""
from pathlib import Path
import urllib.request,urllib.parse,json,hashlib,sys,time
BASE=Path(__file__).resolve().parents[1]/'assets/airliners/preparation/brand-art';BASE.mkdir(exist_ok=True)
FILES=['Breeze Airways.svg','Flair Airlines logo (2019).svg','Air Premia logo.svg','ZIPAIR logo.svg','Frontier Airlines logo.svg','United Airlines wordmark.svg','Alaska Airlines logo.svg','American Airlines American Eagle Logo.svg','Abx Air logo.svg','Star Alliance logo.svg']
for name in sys.argv[1:] or FILES:
 meta=BASE/(name.rsplit('.',1)[0]+'.json');path=BASE/name
 def read(url):return urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'PropWorkshop/1.0 (aircraft texture research)'}),timeout=40).read()
 try:
  if not meta.exists():
   url='https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode({'action':'query','titles':'File:'+name,'prop':'imageinfo','iiprop':'url|extmetadata|sha1','format':'json'});meta.write_bytes(read(url))
  d=json.loads(meta.read_text());info=list(d['query']['pages'].values())[0]['imageinfo'][0];license=info['extmetadata']['LicenseShortName']['value']
  if license!='Public domain':print(name,'HELD',license,flush=True);continue
  if not path.exists():path.write_bytes(read(info['url'].split('?')[0]))
  b=path.read_bytes();actual=int(hashlib.sha1(b).hexdigest(),16);expected=info.get('sha1')
  if expected:assert actual==int(expected,16 if len(expected)==40 else 36),'Source hash mismatch'
  path.with_suffix('.asset.json').write_text(json.dumps({'sourceFilePage':'https://commons.wikimedia.org/wiki/File:'+urllib.parse.quote(name),'sourceURL':info['url'].split('?')[0],'license':license,'author':info['extmetadata'].get('Artist',{}).get('value'),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'use':'Airline livery reproduction; brand marks identify aircraft operators and do not imply endorsement.'},indent=2)+'\n');print(name,'verified',len(b),flush=True)
 except Exception as error:print(name,'FAILED',error,flush=True)
 time.sleep(.3)
