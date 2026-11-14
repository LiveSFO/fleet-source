"""Extract practical fixture locations from source data, excluding simulator halos."""
import re,math
from mathutils import Vector

def fixture_kind(name):
 s=name.lower()
 if re.search('lighted|lightmap|flare|\\.spot|ground|interior|cockpit',s):return None
 if 'beacon' in s:return 'beacon'
 if 'strobe' in s or 'flash' in s:return 'strobe'
 if 'turnoff' in s:return 'turnoff'
 if 'taxi' in s or s=='tlight':return 'taxi'
 if re.search('landing|landlt|lnd|center_light',s):return 'landing'
 if 'winglight' in s or 'wing-light' in s:return 'winglight'
 if 'logo' in s:return 'logo'
 if re.search('navlight|navlite|rednav|greennav|[lr]hnav|taillight',s):return 'nav'
 return None

def color_for(name,kind,position):
 s=name.lower()
 if kind=='beacon' or 'rednav' in s:return 'red'
 if 'greennav' in s:return 'green'
 if kind=='nav' and abs(position[2])>2:return 'red' if position[2]>0 else 'green'
 return 'white'

def static_fixtures(specs):
 out=[]
 for spec in specs:
  for a in spec['tree'].findall('animation'):
   if a.findtext('type')!='translate' or a.find('property') is not None or a.find('offset-m') is None or len(a.findall('axis'))!=1:continue
   axis=a.find('axis');v=Vector([float(axis.findtext(k,'0')) for k in 'xyz'])
   if v.length<1e-8:continue
   v.normalize();v*=float(a.findtext('offset-m'));p=spec['placement']@Vector((v.x,v.z,-v.y))
   for target in a.findall('object-name'):
    kind=fixture_kind(target.text or '')
    if kind:out.append({'name':target.text,'kind':kind,'color':color_for(target.text,kind,p),'position':list(p),'basis':'Source static light translation in '+spec['xml']})
 return out

def mesh_fixture(name,vertices):
 kind=fixture_kind(name)
 if not kind or not vertices:return None
 lo=[min(v[i] for v in vertices) for i in range(3)];hi=[max(v[i] for v in vertices) for i in range(3)]
 if max(b-a for a,b in zip(lo,hi))>1.6:return None
 p=[(a+b)/2 for a,b in zip(lo,hi)]
 return {'name':name,'kind':kind,'color':color_for(name,kind,p),'position':p,'basis':'Source fixture mesh bounds'}

def merge_fixtures(source,static,mesh):
 static_names={x['name'] for x in static};result=[]
 for item in source+static+[m for m in mesh if m['name'] not in static_names]:
  if any(i['kind']==item['kind'] and i['color']==item['color'] and sum((a-b)**2 for a,b in zip(i['position'],item['position']))<.35**2 for i in result):continue
  result.append(item)
 return result
