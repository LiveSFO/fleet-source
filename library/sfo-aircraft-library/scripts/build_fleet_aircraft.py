"""Data-only, configuration-driven exterior conversion with source group rigs.
Blender reads AC/XML/texture data; no upstream Python/Nasal code is executed.
"""
import bpy,sys,pathlib,json,math,hashlib,re,xml.etree.ElementTree as ET
from mathutils import Matrix,Vector
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from ac3d_data import read_ac
from fleet_lighting import static_fixtures,mesh_fixture,merge_fixtures
from fleet_variant_geometry import construct_variant,remap_span
from fleet_paint_projection import apply_paint_projection
from fleet_authored_paint import apply_authored_paint
from fleet_component_transplants import transplant_components
from fleet_cargo_geometry import convert_cargo
from fleet_geometry_details import fill_door_windows,fill_cockpit_openings,add_reverser_cascades,add_propellers
from aircraft_assembly import assembly_specs,resolve_path,condition_value
ROOT=pathlib.Path(__file__).resolve().parents[1];BASE=ROOT/'assets/airliners'
CONFIG=json.loads((BASE/'fleet-build-config.json').read_text())
C=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
def fg(v):return [v[0],v[2],-v[1]]
def source_float(value):return float({'-5.5.88':'-5.88','0.0z':'0.0',None:'0'}.get(value,value))
def vector(e,tag,default):
 q=e.find(tag)
 if q is None:return default
 return [source_float(q.findtext(c,str(v))) for c,v in zip('xyz',default)]
def parse_motions(xml,cfg,tree=None):
 out=[]
 for a in (tree if tree is not None else ET.parse(xml).getroot()).findall('animation'):
  kind=a.findtext('type');p=a.findtext('property','');control=None
  if kind not in ['rotate','translate','spin']:continue
  if p in cfg.get('propertyControls',{}):control=cfg['propertyControls'][p]
  elif 'gear/gear' in p and 'position-norm' in p:control='gear'
  elif any(t in p for t in ['flap-pos-norm','flaps-pos-norm','flap-pos-deg']):control='flaps'
  elif 'reverser' in p:control='reversers'
  elif 'spoiler' in p or 'speedbrake' in p:control='spoilers'
  elif kind=='spin' and ('engines/engine' in p or 'rotor' in p):control='fans'
  if control is None:continue
  if control=='fans' and kind=='rotate':kind='spin'
  ax=a.find('axis');axis=vector(a,'axis',[1,0,0]);center=[0,0,0]
  e=a.find('center')
  if e is not None:center=[source_float(e.findtext(c+'-m','0')) for c in 'xyz']
  if ax is not None and ax.find('x1-m') is not None:
   center=[source_float(ax.findtext(c+'1-m','0')) for c in 'xyz'];p2=[source_float(ax.findtext(c+'2-m','0')) for c in 'xyz'];axis=[p2[i]-center[i] for i in range(3)]
  out.append({'control':control,'type':kind,'property':p,'spinDirection':-1 if kind=='spin' and float(a.findtext('factor','1'))<0 else 1,'inputScale':cfg.get('propertyInputScales',{}).get(p,40 if 'flap-pos-deg' in p else 1),'targets':[q.text for q in a.findall('object-name')],'axis':fg(axis),'center':fg(center),'factor':float(a.findtext('factor','1')),'offset':source_float(a.findtext('offset-deg',a.findtext('offset-m','0'))),'interpolation':[[source_float(q.findtext('ind')),source_float(q.findtext('dep'))] for q in a.findall('interpolation/entry')],'min':a.findtext('min-deg',a.findtext('min-m')),'max':a.findtext('max-deg',a.findtext('max-m'))})
 return out

def build(key,cfg,liv):
 if cfg.get('format')=='reference-loft':
  from build_reference_jets import build as build_reference
  profile=json.loads((BASE/cfg['source']).read_text())[key]
  livery=next(spec for spec in profile['liveries'] if spec['id']==liv['id'])
  return build_reference(BASE,key,profile,livery)
 if cfg.get('format')=='xplane-obj8':
  from build_xplane_fleet import build as build_xplane
  return build_xplane(BASE,key,cfg,liv)
 cfg={**cfg,'dimensions':dict(cfg['dimensions']),**liv.get('configuration',{})}
 folder=BASE/key;folder.mkdir(exist_ok=True);ex=folder/'exports';ex.mkdir(exist_ok=True);up=BASE/cfg['source']/'upstream'
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 # Paint donors can retain indirect library datablocks after their scene
 # objects are removed. Purge those before a later batch item overwrites the
 # donor's editable scene (for example the two EVA 787 variants).
 bpy.data.orphans_purge(do_recursive=True)
 # Drop orphan datablocks so stable source names survive sequential livery builds.
 for collection in [bpy.data.meshes,bpy.data.materials,bpy.data.images]:
  for block in list(collection):
   if block.users==0:collection.remove(block)
 root=bpy.data.objects.new('Aircraft',None);bpy.context.collection.objects.link(root);root['aircraft']=cfg['label'];root['livery']=liv['name'];root['units']='meters'
 properties=dict(cfg.get('properties',{}));livery_xml=None
 if liv.get('xml'):
  livery_xml=BASE/liv['xml'][1:] if liv['xml'].startswith('@') else up/liv['xml']
  def propwalk(e,path=''):
   here=path+'/'+e.tag if e.tag!='PropertyList' else ''
   if len(e)==0:
    value=e.text.strip() if e.text else ''
    properties[here.lstrip('/')]=value.lower() in ['true','1'] if e.get('type')=='bool' or value in ['true','false'] else float(value) if e.get('type') in ['int','double','float','long'] else value
   else:
    for child in e:propwalk(child,here)
  propwalk(ET.parse(livery_xml).getroot())
 properties.update(cfg.get('forcedProperties',{}))
 for alias,source_property in cfg.get('propertyAliases',{}).items():
  if source_property in properties:properties[alias]=properties[source_property]
 for variant in cfg.get('dimensionVariants',[]):
  if properties.get(variant['property'])==variant['value']:cfg['dimensions']={**cfg['dimensions'],**variant['dimensions']}
 cfg=dict(cfg,properties=properties)
 mats={};objects=[];motions=[];missing=set();groups={};source_ac=[];allgroups={};instance_parts={};aliases_all=[];discarded_vertex_count=0
 specs,source_lights,skipped_models=assembly_specs(up,cfg['models'],cfg);static_lights=static_fixtures(specs);mesh_lights=[]
 def getmat(md,texture,role):
  signature=(json.dumps(md,sort_keys=True),str(texture),role)
  if signature in mats:return mats[signature]
  m=bpy.data.materials.new((texture.stem if texture else md['name'])+'_'+role);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF')
  p.inputs['Base Color'].default_value=(*md['rgb'],1);p.inputs['Roughness'].default_value=.30;p.inputs['Metallic'].default_value=.10;p.inputs['Coat Weight'].default_value=.25;p.inputs['Coat Roughness'].default_value=.22
  if texture:
   if texture.exists():
    im=bpy.data.images.load(str(texture),check_existing=True);im.pack();tx=m.node_tree.nodes.new('ShaderNodeTexImage');tx.image=im;m.node_tree.links.new(tx.outputs['Color'],p.inputs['Base Color'])
   else:missing.add(str(texture))
  if role in ['cockpit','cabin']:
   for link in list(p.inputs['Base Color'].links):m.node_tree.links.remove(link)
   p.inputs['Base Color'].default_value=(.009,.018,.028,1);p.inputs['Roughness'].default_value=.24;p.inputs['Metallic'].default_value=.12;p.inputs['Specular IOR Level'].default_value=.25;p.inputs['Coat Weight'].default_value=.22;p.inputs['Alpha'].default_value=1
   if role=='cockpit':m['cockpitGlazing']=True
   else:m['cabinWindow']=True;p.inputs['Emission Color'].default_value=(1,.69,.36,1);p.inputs['Emission Strength'].default_value=0
  if role=='surface' and texture and cfg.get('cabinMask') and re.search(cfg['cabinMask']['texturePattern'],str(texture),re.I):
   mask=bpy.data.images.load(str(BASE/cfg['cabinMask']['path']),check_existing=True);mask.pack();tx=m.node_tree.nodes.new('ShaderNodeTexImage');tx.image=mask;m.node_tree.links.new(tx.outputs['Color'],p.inputs['Emission Color']);p.inputs['Emission Strength'].default_value=1;m['cabinWindow']=True;m['cabinMask']=cfg['cabinMask']['path']
  if role=='chrome' or 'chrome' in md['name'].lower():p.inputs['Metallic'].default_value=.85;p.inputs['Roughness'].default_value=.25
  mats[signature]=m;return m
 for spec in specs:
  rel=spec['xml'];xml=up/rel;tree=spec['tree'];value=tree.findtext('path');scope=spec['scope'];placement=spec['placement']
  if value is None:
   for m in parse_motions(xml,cfg,tree):
    m['sourceTargets']=list(m['targets']);m['model']=rel;m['scope']=scope;m['center']=list(placement@Vector(m['center']));m['axis']=list(placement.to_3x3()@Vector(m['axis']));motions.append(m)
   continue
  ac=resolve_path(up,xml,value);defs,world=read_ac(ac);source_ac.append(str(ac.relative_to(up.resolve())))
  partmotions=parse_motions(xml,cfg,tree);localgroups={}
  texture_bindings=[];selected_out=set()
  def texture_path(value):
   value=value.replace('\\','/').lstrip('/')
   candidates=[xml.parent/value,up/value,up/'Models'/value,ac.parent/value]
   if cfg.get('sourcePackage'):candidates.append(up/cfg['sourcePackage']/'Models'/value)
   if livery_xml is not None:
    for parent in list(livery_xml.parents)[:6]:
     candidates += [parent/value,parent/pathlib.PurePosixPath(value).name]
     if value.startswith('Liveries/'):candidates.append(parent/value[len('Liveries/'):])
   for p in candidates:
    if p.exists():return p
   matches=list(up.rglob(pathlib.PurePosixPath(value).name))
   if len(matches)==1:return matches[0]
   return candidates[0]
  for a in tree.findall('animation'):
   if a.findtext('type')=='material' and a.find('texture-prop') is not None:
    prop=a.findtext('property-base','').rstrip('/')+'/'+a.findtext('texture-prop')
    value=properties.get(prop.lstrip('/'))
    if value:texture_bindings.append(([q.text for q in a.findall('object-name')],texture_path(value)))
   if a.findtext('type')=='select' and condition_value(a.find('condition'),properties) is False:selected_out.update(q.text for q in a.findall('object-name'))

  def walk(o,parent=Matrix.Identity(4),ancestors=(),nodepath=()):
   nonlocal discarded_vertex_count
   r=o['rot'];local=Matrix([r[0:3],r[3:6],r[6:9]]).to_4x4();local.translation=Vector(o['loc']);transform=parent@local;name=o['name'];lineage=(*ancestors,name)
   if o['faces']:
    referenced={i for f in o['faces'] for i in f['v']};source_vertices=[placement@(transform@Vector(o['verts'][i])) for i in referenced];fixture=mesh_fixture(name,source_vertices)
    if fixture and not any(re.search(p,name,re.I) for p in cfg.get('ignoreMeshFixtures',[])):mesh_lights.append(fixture)
   if any(re.search(p,name,re.I) for p in cfg.get('skipPatterns',[])) or any(q in selected_out for q in lineage):return
   if o['faces']:
    referenced=sorted({i for f in o['faces'] for i in f['v']});remap={old:new for new,old in enumerate(referenced)};discarded_vertex_count+=len(o['verts'])-len(referenced)
    mesh_faces=[dict(f,v=[remap[i] for i in f['v']]) for f in o['faces']]
    verts=[C@(placement@(transform@Vector(o['verts'][i]))) for i in referenced]
    me=bpy.data.meshes.new(name or 'Surface');me.from_pydata(verts,[],[f['v'] for f in mesh_faces]);me.update();ob=bpy.data.objects.new(name or 'Surface',me);bpy.context.collection.objects.link(ob);ob.parent=root
    ob['sourceName']=name;ob['sourceModel']=rel;ob['sourcePartId']=scope+'#'+'.'.join(map(str,nodepath));ob['sourceAC']=str(ac.relative_to(up.resolve()));ob['sourceGroups']=json.dumps(lineage)
    for group in lineage:localgroups.setdefault(group,set()).add(ob['sourcePartId'])
    texture=None
    if o['texture']:
     replacement=liv.get('textures',{}).get(pathlib.PurePosixPath(o['texture']).name)
     texture=(up/replacement) if replacement else ac.parent/o['texture']
     if not texture.exists():
      found=list(up.rglob(pathlib.PurePosixPath(o['texture']).name))
      if len(found)==1:texture=found[0]
    for pattern,prop in cfg.get('texturePropertyOverrides',{}).items():
     if o['texture'] and re.search(pattern,pathlib.PurePosixPath(o['texture']).name,re.I) and cfg['properties'].get(prop):texture=texture_path(str(cfg['properties'][prop]))
    for targets,override in texture_bindings:
     if any(q in targets for q in lineage):texture=override
    if texture:
     for pattern,replacement in cfg.get('finalTextureOverrides',{}).items():
      if re.search(pattern,str(texture),re.I):texture=BASE/replacement
    slots={};uv=me.uv_layers.new(name='UVMap')
    for poly,f in zip(me.polygons,mesh_faces):
     idx=f['mat'];md=defs[idx];role='surface'
     glass=md['trans']>.1 and max(md['rgb'])-min(md['rgb'])<.25
     if re.search(cfg.get('cockpitPattern',r'wind(screen|sheild|shield)$'),name,re.I) or (texture and cfg.get('cockpitTexturePattern') and re.search(cfg['cockpitTexturePattern'],texture.name,re.I)):role='cockpit'
     elif any(re.search(p,name,re.I) for p in cfg.get('cabinPatterns',[])):role='cabin'
     elif re.search('chrome|leading.edge|wingedge|hstabedge|vstabedge',name,re.I):role='chrome'
     elif glass and not re.search('nav|lamp|light|beacon|lens|strobe|surge',name,re.I):
      # Transparent neutral AC materials are glazing, never simulator halo discs.
      coords=[verts[i] for i in f['v']];xmin=min(v.x for v in coords);xmax=max(v.x for v in coords)
      role='cockpit' if xmin<cfg.get('cockpitCutoff',-1e8) and xmax<cfg.get('cockpitCutoff',-1e8)+3 else 'cabin'
     if cfg.get('splitGlazingPattern') and re.search(cfg['splitGlazingPattern'],name,re.I):
      role='cockpit' if sum(verts[i].x for i in f['v'])/len(f['v'])<cfg['cockpitCutoff'] else 'cabin'
     k=(idx,role)
     if k not in slots:slots[k]=len(slots);me.materials.append(getmat(md,texture,role))
     poly.material_index=slots[k];poly.use_smooth=bool(f['surf']&0x10)
     for loop,coord in zip(poly.loop_indices,f['uv']):uv.data[loop].uv=(coord[0]*o['texrep'][0]+o['texoff'][0],coord[1]*o['texrep'][1]+o['texoff'][1])
    me.set_sharp_from_angle(angle=math.radians(o['crease']));objects.append(ob)
   for i,child in enumerate(o['children']):walk(child,transform,lineage,(*nodepath,i))
  walk(world)
  for group,parts in localgroups.items():allgroups[(scope,group)]=parts
  instance_parts[scope]={p for parts in localgroups.values() for p in parts}
  aliases_all.extend((scope,a) for a in tree.findall('animation') if a.findtext('name') and a.find('object-name') is not None)
  for m in partmotions:
   m['sourceTargets']=list(m['targets']);m['model']=rel;m['scope']=scope
   m['center']=list(placement@Vector(m['center']));m['axis']=list(placement.to_3x3()@Vector(m['axis']))
   motions.append(m)
 # Child model instances are named targets in their parent assembly XML.
 for spec in reversed(specs):
  scope=spec['scope'];parent=spec['parentScope'];parts=instance_parts.get(scope,set())
  if parent is not None:
   instance_parts.setdefault(parent,set()).update(parts)
   allgroups.setdefault((parent,spec['instanceName']),set()).update(parts)
   for (group_scope,name),group_parts in list(allgroups.items()):
    if group_scope==scope:allgroups.setdefault((parent,name),set()).update(group_parts)
 for _ in range(16):
  changed=False
  for scope,a in aliases_all:
   alias_key=(scope,a.findtext('name'));parts={p for q in a.findall('object-name') for p in allgroups.get((scope,q.text),set())}
   if not parts.issubset(allgroups.get(alias_key,set())):allgroups.setdefault(alias_key,set()).update(parts);changed=True
  if not changed:break
 for fallback in cfg.get('fallbackMotions',[]):
  for ob in objects:
   if not re.search(fallback['targetPattern'],ob['sourceName'],re.I) or not re.search(fallback.get('modelPattern','.*'),ob['sourceModel'],re.I):continue
   motions.append({'control':fallback['control'],'type':fallback['type'],'property':'original-visual-actuator','factor':fallback['factor'],'offset':0,'axis':fallback.get('axis',[1,0,0]),'center':fallback.get('center',[0,0,0]),'interpolation':[],'min':None,'max':None,'targets':[ob['sourceName']],'scope':'original:'+ob['sourcePartId'],'targetPartIds':[ob['sourcePartId']],'model':ob['sourceModel'],'basis':fallback['basis']})
 for m in motions:
  if 'targetPartIds' not in m:m['targetPartIds']=sorted({p for name in m['targets'] for p in allgroups.get((m['scope'],name),set())})
 component_transplants=transplant_components(BASE,cfg,objects,motions,root)
 variant_construction=construct_variant(objects,motions,cfg)
 if cfg.get('trent7000Exterior'):
  from fleet_trent7000 import add_trent7000
  variant_construction['trent7000Exterior']=add_trent7000(objects,motions,root,cfg)
 if cfg.get('propellerAssemblies'):
  added=add_propellers(objects,root,motions,cfg['propellerAssemblies'])
  variant_construction['authoredPropellerBlades']=[o['sourceName'] for o in added]
 if cfg.get('cargoConversion'):variant_construction['cargoConversion']=convert_cargo(objects,root,cfg['cargoConversion'])
 if cfg.get('reverserCascades'):
  details=add_reverser_cascades(objects,root,cfg['reverserCascades']);objects.extend(details)
  variant_construction['reverserCascades']={'addedParts':[o['sourceName'] for o in details],'basis':'Original illustrative turning vanes fitted inside source translating-sleeve geometry; not engine engineering CAD.'}
 if component_transplants:variant_construction['componentTransplants']=component_transplants
 cockpit_repairs=[];opening_diagnostics=[]
 if cfg.get('fillCockpitOpenings') and not any(m and m.get('cockpitGlazing') for ob in objects for m in ob.data.materials):
  cockpit_repairs,opening_diagnostics=fill_cockpit_openings(objects,root,getmat({'name':'Fitted windshield','rgb':[0,0,0],'trans':0},None,'cockpit'));objects.extend(cockpit_repairs)
 (folder/'cockpit-opening-review.json').write_text(json.dumps(opening_diagnostics,indent=2))
 fitted_cabin=[]
 if cfg.get('fillCabinOpenings'):
  fitted_cabin,cabin_diagnostics=fill_cockpit_openings(objects,root,getmat({'name':'Fitted cabin pane','rgb':[0,0,0],'trans':0},None,'cabin'),kind='cabin');objects.extend(fitted_cabin)
 added_panes=fill_door_windows(objects,root,getmat({'name':'Door glazing','rgb':[0,0,0],'trans':0},None,'cabin'))
 for pane in added_panes:
  for m in motions:
   if pane['sourceParentPartId'] in m['targetPartIds']:m['targetPartIds'].append(pane['sourcePartId'])
 objects.extend(added_panes)
 if missing:raise ValueError('Missing textures: '+repr(sorted(missing)))
 allv=[v.co for ob in objects for v in ob.data.vertices];lo=[min(v[i] for v in allv) for i in range(3)];hi=[max(v[i] for v in allv) for i in range(3)]
 (folder/'source-bounds.json').write_text(json.dumps([{'name':ob['sourceName'],'model':ob['sourceModel'],'min':[min(v.co[i] for v in ob.data.vertices) for i in range(3)],'max':[max(v.co[i] for v in ob.data.vertices) for i in range(3)]} for ob in objects],indent=2))
 source_lights=merge_fixtures(source_lights,static_lights,mesh_lights)
 if cfg.get('spanStations'):
  for light in source_lights:
   light['position'][2]=remap_span(light['position'][2],cfg['spanStations']['stations'])[0]
 if cfg.get('a350Extension'):
  for light in source_lights:
   x=light['position'][0]
   wing=abs(light['position'][2])>8 or 'landing' in light['name'].lower()
   light['position'][0]+=sum(p['length'] for p in cfg['a350Extension']['plugs'] if x>=p['station'] and not (wing and p['aft']))
 if cfg.get('lightsFrom'):
  source_lights.extend(json.loads((BASE/cfg['lightsFrom']).read_text()))
 calibration=[1,1,1];raw_dimensions={'length':hi[0]-lo[0],'span':hi[1]-lo[1]}
 if cfg.get('sourceUnitScale'):
  factor=cfg['sourceUnitScale'];variant_construction['sourceUnitNormalization']={'scale':factor,'rawDimensions':dict(raw_dimensions),'basis':cfg['sourceUnitBasis']}
  for ob in objects:
   for v in ob.data.vertices:v.co*=factor
  for m in motions:
   m['center']=[v*factor for v in m['center']]
   if m['type']=='translate':
    m['factor']*=factor;m['offset']*=factor;m['interpolation']=[[a,b*factor] for a,b in m['interpolation']]
  for light in source_lights:light['position']=[v*factor for v in light['position']]
  lo=[v*factor for v in lo];hi=[v*factor for v in hi];raw_dimensions={'length':hi[0]-lo[0],'span':hi[1]-lo[1]}
 if cfg.get('calibrateEnvelope',False):
  calibration=[cfg['dimensions']['length']/raw_dimensions['length'],1,cfg['dimensions']['span']/raw_dimensions['span']]
  if any(abs(v-1)>.05 for v in calibration):raise ValueError('Source variant differs by >5%; requires remodeling rather than envelope calibration: '+repr(calibration))
  for ob in objects:
   for v in ob.data.vertices:v.co.x*=calibration[0];v.co.y*=calibration[2]
  for m in motions:
   m['center']=[v*scale for v,scale in zip(m['center'],calibration)];m['axis']=list(Vector([v*scale for v,scale in zip(m['axis'],calibration)]).normalized())
  for light in source_lights:light['position']=[v*scale for v,scale in zip(light['position'],calibration)]
  lo=[lo[0]*calibration[0],lo[1]*calibration[2],lo[2]];hi=[hi[0]*calibration[0],hi[1]*calibration[2],hi[2]]
 if cfg.get('engineCenterline'):
  variant_construction['finalEnginePlacement']=construct_variant(objects,motions,{k:cfg[k] for k in ['engineCenterline','engineFrontDistance'] if k in cfg})
 internal=[];internal_ids=[]
 if cfg.get('stowMask',False):
  targets={n for m in motions if m['control']=='gear' for n in m.get('targetPartIds',[])}
  for ob in objects:
   if ob['sourcePartId'] in targets and not re.search(cfg.get('gearDoorPattern','door'),ob['sourceName'],re.I):internal.append(ob['sourceName']);internal_ids.append(ob['sourcePartId']);ob['gearInternal']=True
 review_points={}
 for role,field in [('cockpit','cockpitGlazing'),('door','cabinDoorWindow')]:
  points=[]
  for ob in objects:
   if role=='door':
    if ob.get(field):points += [v.co.copy() for v in ob.data.vertices if v.co.y<0]
   else:
    for poly in ob.data.polygons:
     if ob.data.materials[poly.material_index].get(field):points += [ob.data.vertices[i].co.copy() for i in poly.vertices]
  if points:
   point=(sum(points,Vector())/len(points));review_points[role]=[point.x,point.z,-point.y]
 def object_center(ob):
  pts=[v.co for v in ob.data.vertices];return Vector([(min(v[i] for v in pts)+max(v[i] for v in pts))/2 for i in range(3)])
 front_doors=[ob for ob in objects if re.search(r'^DoorL1$|^door\.FLO$|^entry1l$',ob['sourceName'],re.I)]
 if front_doors:
  ob=min(front_doors,key=lambda o:object_center(o).x);p=object_center(ob);p.z+=(max(v.co.z for v in ob.data.vertices)-min(v.co.z for v in ob.data.vertices))*.15;review_points['door']=[p.x,p.z,-p.y]
 for control,view,pattern in [('reversers','engine',r'revers'),('gear','gear',r'wheel|tire|tyre|roue'),('flaps','wing',r'flap')]:
  candidates=[o for o in objects if re.search(pattern,o['sourceName'],re.I) and any(m['control']==control and o['sourcePartId'] in m['targetPartIds'] for m in motions)]
  if control!='gear':candidates=[o for o in candidates if any(v.co.y<-.5 for v in o.data.vertices)]
  else:candidates=[o for o in candidates if object_center(o).x<lo[0]+(hi[0]-lo[0])*.4]
  if candidates:
   ob=min(candidates,key=lambda o:object_center(o).x)
   pts=[v.co for v in ob.data.vertices if control=='gear' or v.co.y<-.5]
   p=Vector([(min(v[i] for v in pts)+max(v[i] for v in pts))/2 for i in range(3)])
   review_points[view]=[p.x,p.z,-p.y]
 for name,point in cfg.get('reviewPoints',{}).items():
  if name not in review_points:review_points[name]=[v*scale for v,scale in zip(point,calibration)]
 rig={'aircraft':key,'label':cfg['label'],'livery':liv,'referenceDimensions':cfg['dimensions'],'axes':'X aft; Y up; Z port','bounds':{'min':[lo[0],lo[2],-hi[1]],'max':[hi[0],hi[2],-lo[1]]},'motions':motions,'gearInternalParts':internal,'gearInternalPartIds':internal_ids,'missingTextures':[],'sourceAC':source_ac,'discardedUnreferencedVertices':discarded_vertex_count,'provenance':cfg['source'],'variantConstruction':variant_construction,'capabilities':sorted({m['control'] for m in motions}),'reviewPoints':review_points,'fidelityNotes':cfg.get('notes',[]),'reviewStatus':'build-awaiting-validation','addedDoorWindowPanes':len(added_panes),'fittedCockpitOpenings':len(cockpit_repairs),'fittedCabinOpenings':len(fitted_cabin),'envelopeCalibration':{'rawDimensions':raw_dimensions,'axisScale':calibration},'skippedSourceModels':skipped_models,'unresolvedMotions':[{'control':m['control'],'targets':m['targets'],'model':m['model']} for m in motions if not m['targetPartIds']]}
 projection=apply_paint_projection(BASE,key,liv,objects,root)
 rig['cargo']=cfg.get('cargo',False)
 for field in ['minimumCabinSpanRatio','noseWheelPartName','expectedAnimations','category']:
  if field in cfg:rig[field]=cfg[field]
 if projection:rig['paintProjection']=projection
 authored=apply_authored_paint(BASE,key,liv,objects)
 if authored:rig['authoredPaint']=authored
 if liv.get('surfaceDecals'):
  from fleet_xplane_variants import fit_registration_decals
  rig['surfaceDecals']=fit_registration_decals(BASE,objects,root,liv['surfaceDecals'])
 if source_lights or cfg.get('extraLights'):(folder/'lights.json').write_text(json.dumps(source_lights+cfg.get('extraLights',[]),indent=2))
 (ex/(liv['id']+'.rig.json')).write_text(json.dumps(rig,indent=2));bpy.context.scene.unit_settings.system='METRIC'
 bpy.ops.wm.save_as_mainfile(filepath=str(folder/(liv['id']+'.blend')),compress=True,copy=True)
 bpy.ops.export_scene.gltf(filepath=str(ex/(liv['id']+'.glb')),export_format='GLB',export_extras=True,export_yup=True,export_cameras=False,export_lights=False,export_animations=False)
 print('FLEET EXPORTED',key,liv['id'],'bounds',rig['bounds'],'motions',len(motions),'meshes',len(objects),flush=True)
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
specific={arg for arg in args if '/' in arg}
families={arg for arg in args if arg in CONFIG}
livery_ids={arg for arg in args if '/' not in arg and arg not in CONFIG}
selected_count=0
for key,cfg in CONFIG.items():
 for liv in cfg['liveries']:
  if f"{key}/{liv['id']}" in specific or (
   not args or key in families and (not livery_ids or liv['id'] in livery_ids)
  ):
   selected_count+=1
   build(key,cfg,liv)
if not selected_count:raise ValueError('No aircraft/livery matched: '+repr(args))
