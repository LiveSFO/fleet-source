"""Read FlightGear XML assembly/include data, never executable scripts."""
from pathlib import Path
import copy,xml.etree.ElementTree as ET,re

def merge_elements(base,override):
 result=copy.deepcopy(base);result.attrib.update({k:v for k,v in override.attrib.items() if k!='include'})
 if override.text and override.text.strip():result.text=override.text
 for child in override:
  # Animation definitions are ordered records. Named model records merge by
  # their explicit instance name; scalar property nodes override by tag/index.
  if child.tag=='animation':result.append(copy.deepcopy(child));continue
  named=child.findtext('name') if child.tag=='model' else None
  candidates=[q for q in result if q.tag==child.tag and q.get('n')==child.get('n')]
  if child.tag=='model':candidates=[q for q in candidates if named and q.findtext('name')==named]
  if candidates:
   old=candidates[0];at=list(result).index(old);result.remove(old);result.insert(at,merge_elements(old,child))
  else:result.append(copy.deepcopy(child))
 return result

def load_xml(path,stack=(),override=None):
 path=Path(path).resolve()
 if path.suffix.lower()=='.ac':
  root=ET.Element('PropertyList');ET.SubElement(root,'path').text=str(path)
  return merge_elements(root,override) if override is not None else root
 if path in stack:raise ValueError('Circular source XML include: '+str(path))
 root=ET.parse(path).getroot()
 def resolve(element):
  local=copy.deepcopy(element)
  for i,child in enumerate(list(local)):local.remove(child);local.insert(i,resolve(child))
  include=element.get('include')
  if include:
   include_path=path.parent/include
   inherited=load_xml(include_path,(*stack,path))
   # An include in <model> incorporates its PropertyList contents.
   inherited.tag=element.tag;return merge_elements(inherited,local)
  return local
 resolved=merge_elements(resolve(root),override) if override is not None else resolve(root)
 for parent in list(resolved.iter()):
  for child in list(parent):
   if child.get('omit-node') in ['y','yes','true']:
    index=list(parent).index(child);parent.remove(child)
    for n,item in enumerate(list(child)):parent.insert(index+n,item)
 parents={c:p for p in resolved.iter() for c in p}
 def alias_text(node,seen=()):
  if node in seen:return None
  if node.text and node.text.strip():return node.text
  alias=node.get('alias')
  if not alias:return node.text
  current=node
  for part in alias.split('/'):
   if part=='..':current=parents.get(current)
   elif part not in ['', '.']:current=current.find(part) if current is not None else None
   if current is None:return None
  return alias_text(current,(*seen,node))
 for node in resolved.iter():
  if node.get('alias') and not (node.text or '').strip():node.text=alias_text(node)
 return resolved

def resolve_path(up,source_xml,value):
 value=value.replace('\\','/');parts=value.split('/')
 if value.startswith('Aircraft/'):
  rest='/'.join(parts[2:]);choices=[up/rest]
  # Some repos wrap the aircraft package in a top-level folder.
  choices+=[p/rest for p in up.iterdir() if p.is_dir()]
 else:choices=[source_xml.parent/value,up/value]
 for p in choices:
  if p.exists():return p.resolve()
 return choices[0].resolve()

def condition_value(node,properties):
 if node is None:return True
 tag=node.tag
 if tag=='condition':return condition_value(next(iter(node),None),properties)
 if tag=='property':return properties.get(node.text,None)
 if tag=='value':
  s=(node.text or '').strip()
  if node.get('type')=='bool' or s in ['true','false']:return s.lower() in ['true','1']
  try:return float(s)
  except ValueError:return s
 vals=[condition_value(c,properties) for c in node]
 if tag=='not':return None if not vals or vals[0] is None else not vals[0]
 if tag=='and':return False if False in vals else None if None in vals else all(vals)
 if tag=='or':return True if True in vals else None if None in vals else any(vals)
 if None in vals or len(vals)<2:return None
 try:
  a,b=vals[:2]
  return {'equals':lambda:a==b,'not-equals':lambda:a!=b,'greater-than':lambda:a>b,'less-than':lambda:a<b,'greater-than-equals':lambda:a>=b,'less-than-equals':lambda:a<=b}.get(tag,lambda:None)()
 except TypeError:return None

def assembly_specs(up,models,cfg):
 """Flatten XML model instances, retaining scopes, source paths and transforms.
 Placement is expressed in glTF/AC axes: X aft, Y up, Z port.
 """
 # Blender mathutils is imported only by the local trusted converter.
 from mathutils import Matrix,Vector
 out=[];lights=[];skipped=[]
 exclude=re.compile(cfg.get('excludeModels',r'/(Cockpit|FlightDeck|Instruments?|Ground|Services?|Operations?|Autopush|Pushback|Human|People|Pilot|Seating|Interior|Shadow|Effects|EFB)/'),re.I)
 properties=cfg.get('properties',{})
 def visit(path,placement,scope,parent_scope=None,instance_name=None,depth=0,overlay=None,lighting_only=False):
  if depth>16:raise ValueError('Source model recursion too deep')
  tree=load_xml(path,override=overlay);rel=str(path.relative_to(up.resolve()))
  if lighting_only and tree.find('path') is not None:tree.remove(tree.find('path'))
  if depth==0:
   for extra in cfg.get('animationSources',[]):
    for animation in load_xml(up/extra).findall('animation'):tree.append(copy.deepcopy(animation))
  spec={'xml':rel,'tree':tree,'placement':placement,'scope':scope,'parentScope':parent_scope,'instanceName':instance_name};out.append(spec)
  hidden_models={q.text for a in tree.findall('animation') if a.findtext('type')=='select' and condition_value(a.find('condition'),properties) is False for q in a.findall('object-name')}
  for i,m in enumerate(tree.findall('model')):
   value=m.findtext('path')
   if not value:continue
   child=resolve_path(up,path,value);name=m.findtext('name',child.stem)
   if name in hidden_models:skipped.append(value+' [parent selection false]');continue
   offsets=m.find('offsets');v=[float(offsets.findtext(c+'-m','0')) if offsets is not None else 0 for c in 'xyz'];offset=Vector((v[0],v[2],-v[1]));local=Matrix.Translation(offset)
   if offsets is not None:
    for tag,axis in [('heading-deg','Y'),('pitch-deg','Z'),('roll-deg','X')]:
     import math
     angle=float(offsets.findtext(tag,'0'));local=local@Matrix.Rotation(math.radians(angle),4,axis)
   place=placement@local
   if exclude.search('/'+value) or re.search(cfg.get('excludeInstancePattern',r'(?!)'),name,re.I) or re.search(r'cockpit|flight.?deck|instrument',Path(value).stem,re.I):skipped.append(value);continue
   if '/light' in value.lower():
    if child.exists() and child.suffix.lower()=='.xml' and load_xml(child).find('model') is not None:
     visit(child,place,scope+'/'+str(i)+':'+name,scope,name,depth+1,m.find('overlay'),lighting_only=True);continue
    label=(name+' '+value).lower();kind='strobe' if any(q in label for q in ['strobe','flashleft','flashright']) else 'beacon' if 'beacon' in label else 'turnoff' if 'turnoff' in label else 'taxi' if 'taxi' in label or 'nosegearlanding' in label else 'winglight' if 'winglight' in label or 'wing.lights' in label else 'logo' if 'logo' in label else 'landing' if 'landing' in label else 'nav' if any(q in label for q in ['nav','green','redlight','tail']) else None
    if kind:
     color='red' if kind=='beacon' or 'red' in label else 'green' if 'green' in label else 'white'
     lights.append({'name':name,'kind':kind,'color':color,'position':list(place.translation),'basis':'Source XML light-model instance offset'})
    continue
   if exclude.search('/'+value) or re.search(cfg.get('excludeInstancePattern',r'(?!)'),name,re.I) or re.search(r'cockpit|flight.?deck|instrument',Path(value).stem,re.I):skipped.append(value);continue
   if condition_value(m.find('condition'),properties) is False:skipped.append(value+' [source condition false]');continue
   if not child.exists():skipped.append(value+' [missing exterior submodel]');continue
   if child.suffix.lower()!='.xml':
    # A model may refer directly to AC data; create a data-only wrapper tree.
    if child.suffix.lower()=='.ac':
     r=copy.deepcopy(m);r.tag='PropertyList';r.find('path').text=str(child)
     out.append({'xml':str(child.relative_to(up.resolve())),'tree':r,'placement':place,'scope':scope+'/'+str(i)+':'+name,'parentScope':scope,'instanceName':name})
    continue
   visit(child,place,scope+'/'+str(i)+':'+name,scope,name,depth+1,m.find('overlay'))
 for i,model in enumerate(models):
  spec={'xml':model} if isinstance(model,str) else model
  offset=spec.get('offset',[0,0,0]);placement=Matrix.Translation(Vector((offset[0],offset[2],-offset[1])))
  visit((up/spec['xml']).resolve(),placement,str(i)+':'+spec['xml'])
 # Deduplicate old/ALS fixture representations occupying the same location.
 seen=set();clean=[]
 for light in lights:
  key=(light['kind'],light['color'],tuple(round(x,1) for x in light['position']))
  if key not in seen:seen.add(key);clean.append(light)
 return out,clean,skipped
