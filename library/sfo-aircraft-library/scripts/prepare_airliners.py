"""Convert pinned FlightGear exterior data to portable PBR GLB + rig metadata.
AC3D geometry/UVs and FlightGear hinge definitions retain their source provenance.
No upstream executable code is loaded.
"""
import bpy,sys,pathlib,json,math,hashlib,xml.etree.ElementTree as ET
from mathutils import Matrix,Vector
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from ac3d_data import read_ac
ROOT=pathlib.Path(__file__).resolve().parents[1];BASE=ROOT/'assets/airliners'
CONFIGS={
 'a320neo':{'label':'Airbus A320neo','length':37.57,'span':35.80,'models':['Models/Fuselage/fuselage.xml'],'liveries':[
  {'id':'british-airways','name':'British Airways','xml':'CFM-NEO/BAW.xml','engine':'Models/Fuselage/a320.cfm.leap.xml'},
  {'id':'sas','name':'SAS','xml':'CFM-NEO/SAS.xml','engine':'Models/Fuselage/a320.cfm.leap.xml'},
  {'id':'lufthansa','name':'Lufthansa','xml':'PW-NEO/DLH.xml','engine':'Models/Fuselage/a320.pw.xml'}]},
 'b738':{'label':'Boeing 737-800','length':39.47,'span':35.79,'models':['Models/737-800.xml','Models/LWing.xml','Models/RWing.xml','Models/HorzStab.xml','Models/VertStab.xml','Models/NoseGear.xml','Models/winglet2.xml'],'liveries':[
  {'id':'ryanair','name':'Ryanair','texture':'RYR.png'},
  {'id':'southwest','name':'Southwest','texture':'SWA-new.png'},
  {'id':'american','name':'American Airlines','texture':'AAL.png'},
  {'id':'united','name':'United Airlines · Continental globe era','texture':'UAL.png'},
  {'id':'alaska','name':'Alaska Airlines','texture':'ASA2.png'},
  {'id':'delta','name':'Delta Air Lines','texture':'DAL.png'}]}}

def vec(e,tag,default):
 v=e.find(tag)
 return [float(v.findtext(k,str(d))) for k,d in zip(['x','y','z'],default)] if v is not None else default
def fg(v):return [v[0],v[2],-v[1]]
def number(s):
 # Upstream left outboard aft flap has a malformed number; mirror the right
 # hinge's verified +5.88 m coordinate. Preserve the upstream file unchanged.
 return float('-5.88' if s=='-5.5.88' else s)
def motions(path):
 x=ET.parse(path).getroot();out=[]
 for a in x.findall('animation'):
  kind=a.findtext('type');prop=a.findtext('property','');control=None
  if kind not in ['rotate','translate','spin']:continue
  if ('gear/gear' in prop and 'position-norm' in prop) or 'hydraulic/gear/door-' in prop:control='gear'
  elif 'flap-pos-norm' in prop or prop.endswith('float[12]'):control='flaps'
  elif prop.endswith('float[11]'):control='slats'
  elif 'reverser-pos' in prop:control='reversers'
  elif 'spoiler' in prop:control='spoilers'
  elif kind=='spin' and 'engines/engine' in prop:control='fans'
  if control is None:continue
  center=[0,0,0];c=a.find('center')
  if c is not None:center=[number(c.findtext(k+'-m','0')) for k in 'xyz']
  axis=vec(a,'axis',[1,0,0]);ax=a.find('axis')
  if ax is not None and ax.find('x1-m') is not None:
   p1=[float(ax.findtext(k+'1-m','0')) for k in 'xyz'];p2=[float(ax.findtext(k+'2-m','0')) for k in 'xyz']
   center=p1;axis=[p2[i]-p1[i] for i in range(3)]
  entries=[[float(q.findtext('ind')),float(q.findtext('dep'))] for q in a.findall('interpolation/entry')]
  out.append({'control':control,'type':kind,'property':prop,'targets':[o.text for o in a.findall('object-name')],'axis':fg(axis),'center':fg(center),'factor':float(a.findtext('factor','1')),'offset':float(a.findtext('offset-deg',a.findtext('offset-m','0'))),'interpolation':entries,'min':a.findtext('min-deg',a.findtext('min-m')),'max':a.findtext('max-deg',a.findtext('max-m'))})
 return out

def run(key,liv):
 cfg=CONFIGS[key];folder=BASE/key;up=folder/'upstream';ex=folder/'exports';ex.mkdir(exist_ok=True)
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 for m in list(bpy.data.materials):bpy.data.materials.remove(m)
 root=bpy.data.objects.new('Aircraft',None);bpy.context.collection.objects.link(root)
 root['aircraft']=cfg['label'];root['livery']=liv['name'];root['units']='meters'
 mats={};seen=set();objects=[];rig=[];missing=set();dupes=0
 replacements={}
 modelpaths=list(cfg['models'])
 if key=='a320neo':
  lx=ET.parse(up/'Models/Liveries'/liv['xml']).getroot();lv=lx.find('sim/model/livery');ld=up/'Models/Liveries'/pathlib.Path(liv['xml']).parent
  replacements['Fuse-Main.png']=next(ld.rglob(lv.findtext('texture-fuselage')))
  en=next(ld.rglob(lv.findtext('texture-engine')))
  replacements['engine-leap1a.png']=en;replacements['engine-pwpp.png']=en
  modelpaths.append(liv['engine']);liv['registration']=lx.findtext('options/model-options/registration')
 else:
  corrected=folder/'generated/SWA-heart-corrected.png'
  replacements['737-800.png']=corrected if liv['id']=='southwest' and corrected.exists() else up/'Models/Liveries-800'/liv['texture']
 def material(md,texture,name):
  if key=='b738' and name=='lreverserib_0':
   texture=None;md=dict(md,name='Dark reverser backing',rgb=[.07,.08,.09])
  cockpit=name.lower()=='windsheild' or (key=='b738' and name=='windows.ext')
  if cockpit:texture=None
  mk=(md['name'],str(texture),('cockpit' if cockpit else 'window' if key=='b738' and name=='rearwindows.ext' else ''))
  if mk in mats:return mats[mk]
  m=bpy.data.materials.new((texture.stem if texture else md['name'])+'_'+mk[2]);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF')
  rgb=md['rgb'];alpha=1-md['trans'];glass='glass' in md['name'].lower() or name.lower() in ['windsheild','shield','windows.int','rearwindows.int']
  p.inputs['Base Color'].default_value=(*rgb,1)
  p.inputs['Roughness'].default_value=.29 if texture else .34
  p.inputs['Metallic'].default_value=.15 if not glass else .05
  p.inputs['Coat Weight'].default_value=.32 if texture else .12
  p.inputs['Coat Roughness'].default_value=.19
  if texture and texture.exists():
   im=bpy.data.images.load(str(texture),check_existing=True);im.pack()
   tx=m.node_tree.nodes.new('ShaderNodeTexImage');tx.image=im
   m.node_tree.links.new(tx.outputs['Color'],p.inputs['Base Color'])
   # Main livery maps are opaque. Placard decals use their supplied alpha.
   if 'placard' in texture.name.lower():
    m.node_tree.links.new(tx.outputs['Alpha'],p.inputs['Alpha']);m.surface_render_method='DITHERED';m.use_transparency_overlap=False
  elif texture:missing.add(str(texture))
  if glass:
   p.inputs['Base Color'].default_value=(.08,.13,.17,1);p.inputs['Alpha'].default_value=.42
   p.inputs['Roughness'].default_value=.13;m.surface_render_method='DITHERED';m.use_transparency_overlap=False
  if cockpit:
   p.inputs['Base Color'].default_value=(.009,.018,.028,1);p.inputs['Alpha'].default_value=1
   p.inputs['Roughness'].default_value=.24;p.inputs['Metallic'].default_value=.12
   p.inputs['Coat Weight'].default_value=.22;p.inputs['Specular IOR Level'].default_value=.25
   p.inputs['Transmission Weight'].default_value=0
   m['cockpitGlazing']=True
  if mk[2]=='window':
   p.inputs['Base Color'].default_value=(.12,.16,.18,1);p.inputs['Alpha'].default_value=1
   p.inputs['Emission Color'].default_value=(1,.64,.28,1);p.inputs['Emission Strength'].default_value=0
   m['cabinWindow']=True
  m.diffuse_color=(*rgb,1);mats[mk]=m;return m
 C=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
 for rel in modelpaths:
  xml=up/rel;tree=ET.parse(xml).getroot();ac=xml.parent/tree.findtext('path');defs,world=read_ac(ac)
  rigpart=motions(xml);rig.extend([dict(m,model=rel) for m in rigpart])
  def walk(o,parent=Matrix.Identity(4)):
   nonlocal dupes
   r=o['rot'];local=Matrix([r[0:3],r[3:6],r[6:9]]).to_4x4();local.translation=Vector(o['loc']);transform=parent@local
   name=o['name'];skip=(key=='a320neo' and (name in ['WingtipFence','navglass','ULD45','ULD46','ULD47','ULD48','Antenna1','Antenna2','Rat'] or name.startswith(('RatSpinner','FanSpinning')))) or (key=='b738' and name in ['windows.int','rearwindows.int'])
   if o['faces'] and not skip:
    verts=[C@(transform@Vector(v)) for v in o['verts']]
    sig=hashlib.sha256(repr(([tuple(round(t,6) for t in v) for v in verts],o['faces'],o['texture'])).encode()).hexdigest()
    if sig in seen:dupes+=1
    else:
     seen.add(sig);me=bpy.data.meshes.new(name);me.from_pydata(verts,[],[f['v'] for f in o['faces']]);me.update()
     ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);ob.parent=root
     ob['sourceName']=name;ob['sourceModel']=rel;ob['sourceAC']=str(ac.relative_to(up))
     texture=None
     if o['texture']:
      texture=replacements.get(pathlib.Path(o['texture']).name,ac.parent/o['texture'])
      if not texture.exists():texture=up/'Models'/o['texture']
     bymat={};uv=me.uv_layers.new(name='UVMap')
     for poly,f in zip(me.polygons,o['faces']):
      idx=f['mat']
      if idx not in bymat:bymat[idx]=len(bymat);me.materials.append(material(defs[idx],texture,name))
      poly.material_index=bymat[idx];poly.use_smooth=bool(f['surf']&0x10)
      for loop,coord in zip(poly.loop_indices,f['uv']):uv.data[loop].uv=(coord[0]*o['texrep'][0]+o['texoff'][0],coord[1]*o['texrep'][1]+o['texoff'][1])
     me.set_sharp_from_angle(angle=math.radians(o['crease']))
     objects.append(ob)
   for child in o['children']:walk(child,transform)
  walk(world)
 if key=='b738':
  # Original visual detail: a fixed cascade lattice is uncovered as the outer
  # sleeve travels aft. Dimensions follow the source sleeve envelope; the vane
  # section is illustrative, not a production CFM56 engineering drawing.
  m=bpy.data.materials.new('Reverser cascade • dark titanium');m.use_nodes=True
  p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.075,.085,.095,1);p.inputs['Metallic'].default_value=.8;p.inputs['Roughness'].default_value=.4
  for side in [-1,1]:
   # Source engines are offset, not exact mirrors. Fit each actual backing.
   backing=next(o for o in objects if o['sourceName']=='lreverserib_0' and (sum(-v.co.y for v in o.data.vertices)/len(o.data.vertices))*side>0)
   coords=[(v.co.x,v.co.z,-v.co.y) for v in backing.data.vertices]
   lo=[min(v[i] for v in coords) for i in range(3)];hi=[max(v[i] for v in coords) for i in range(3)]
   vs=[];faces=[];cy=(lo[1]+hi[1])/2;cz=(lo[2]+hi[2])/2
   ry=(hi[1]-lo[1])*.43;rz=(hi[2]-lo[2])*.43;xstart=lo[0]+.15
   def panel(x0,x1,t0,t1,raised=0):
    i=len(vs)
    for x,t in [(x0,t0),(x1,t0),(x1,t1),(x0,t1)]:
     # AC3D -> Blender
     y=cy+(ry+raised)*math.cos(t);z=cz+(rz+raised)*math.sin(t)
     vs.append((x,-z,y))
    faces.append((i,i+1,i+2,i+3))
   for j in range(40):
    t=j*math.tau/40
    if abs(math.atan2(math.sin(t),math.cos(t)))<.25:continue
    panel(xstart,xstart+.27,t-.012,t+.012,.002)
    for k in range(5):
     x=xstart+k*.052;panel(x,x+.012,t+.018,t+math.tau/40-.018)
   me=bpy.data.meshes.new('Cascade lattice');me.from_pydata(vs,[],faces);me.materials.append(m);me.update()
   ob=bpy.data.objects.new('ReverserCascade'+str(side),me);bpy.context.collection.objects.link(ob);ob.parent=root
   ob['sourceName']='ReverserCascade'+str(side);ob['sourceModel']='Original detail addition';ob['basis']='Illustrative vanes fitted to source sleeve bounds';objects.append(ob)
 if key=='b738':
  # Fill the existing 14 cm circular door peephole boundaries. This preserves
  # the source position, outline and fuselage curvature, with no guessed pane.
  pane=bpy.data.materials.new('Cabin door window');pane.use_nodes=True;pane['cabinWindow']=True
  p=pane.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.012,.025,.038,1)
  p.inputs['Metallic'].default_value=.08;p.inputs['Roughness'].default_value=.23
  p.inputs['Emission Color'].default_value=(1,.69,.36,1);p.inputs['Emission Strength'].default_value=0
  for name in ['doorLF','doorRF','doorLR','doorRR']:
   door=next(o for o in objects if o['sourceName']==name);verts=[v.co.copy() for v in door.data.vertices];edges={}
   for poly in door.data.polygons:
    ids=list(poly.vertices)
    for a,b in zip(ids,ids[1:]+ids[:1]):
     edge=tuple(sorted((a,b)));edges[edge]=edges.get(edge,0)+1
   graph={}
   for (a,b),count in edges.items():
    if count==1:graph.setdefault(a,set()).add(b);graph.setdefault(b,set()).add(a)
   pending=set(graph);holes=[]
   while pending:
    seed=pending.pop();component={seed};stack=[seed]
    while stack:
     for n in graph[stack.pop()]:
      if n in pending:pending.remove(n);component.add(n);stack.append(n)
    points=[verts[i] for i in component];span=[max(v[k] for v in points)-min(v[k] for v in points) for k in range(3)]
    if .1<span[0]<.2 and .1<span[2]<.2:holes.append(points)
   if len(holes)!=1:raise ValueError('Expected one source door pane boundary: '+name)
   points=holes[0];center=sum(points,Vector())/len(points);side=1 if center.y<0 else -1
   points.sort(key=lambda v:math.atan2(v.z-center.z,v.x-center.x));vs=[center]+points
   for v in vs:v.y-=side*.003
   count=len(points);faces=[((0,i+1,(i+1)%count+1) if side==1 else (0,(i+1)%count+1,i+1)) for i in range(count)]
   me=bpy.data.meshes.new(name+'WindowPane');me.from_pydata(vs,[],faces);me.materials.append(pane);me.update()
   ob=bpy.data.objects.new(name+'WindowPane',me);bpy.context.collection.objects.link(ob);ob.parent=root
   ob['sourceName']=name+'WindowPane';ob['sourceModel']='Source door opening fill';ob['cabinDoorWindow']=True;objects.append(ob)
 if key=='a320neo':
  # FlightGear drives these secondary links from simulator-side constraints.
  # In this exterior rig they follow the primary leg, so a stowed aircraft
  # does not retain disconnected links dangling below the closed gear bay.
  followers={
   'NLGFitting':['NLGDragStrutAssembly1','NLGDragStrutAssembly2','NLGLockStay2','NLGLockStay1','NLGTorqueLink2'],
   'MLGFittingL':['MLGLockStayL1','MLGSlaveLinkL2','MLGTorqueLinkL2','SideStayL1','MLGLockstayActuatorL1','MLGLockStayL2','MLGLockstayActuatorL2'],
   'MLGFittingR':['MLGLockStayR1','MLGSlaveLinkR2','MLGTorqueLinkR2','SideStayR1','MLGLockstayActuatorR1','MLGLockStayR2','MLGLockstayActuatorR2']}
  for primary,names in followers.items():
   for motion in rig:
    if motion['control']=='gear' and primary in motion['targets']:
     motion['targets'].extend(names);motion['approximateFollowers']=names;break
 # Bay-internal linkages use source constraints unavailable in this standalone rig.
 # Explicit stow masking prevents them protruding through closed bays; doors stay visible.
 internal=[]
 if key=='a320neo':
  gear_targets={name for motion in rig if motion['control']=='gear' for name in motion['targets'] if 'door' not in name.lower()}
  for ob in objects:
   name=ob['sourceName']
   if (name in gear_targets or (name.startswith(('NLG','MLG')) and 'Door' not in name) or name.startswith(('SideStay','GearLDoorActuator'))):
    internal.append(name);ob['gearInternal']=True
 # Export orientation: native AC3D axes become glTF X aft, Y up, Z port.
 allv=[ob.matrix_world@v.co for ob in objects for v in ob.data.vertices]
 lo=[min(v[i] for v in allv) for i in range(3)];hi=[max(v[i] for v in allv) for i in range(3)]
 print(key,liv['id'],'bounds Blender',lo,hi,'objects',len(objects),'duplicates removed',dupes,flush=True)
 rigfile={'aircraft':key,'label':cfg['label'],'livery':liv,'referenceDimensions':{'length':cfg['length'],'span':cfg['span']},'axes':'X aft; Y up; Z port','bounds':{'min':[lo[0],lo[2],-hi[1]],'max':[hi[0],hi[2],-lo[1]]},'motions':rig,'gearInternalParts':internal,'missingTextures':sorted(missing),'duplicatesRemoved':dupes}
 (ex/(liv['id']+'.rig.json')).write_text(json.dumps(rigfile,indent=2))
 bpy.context.scene.unit_settings.system='METRIC'
 bpy.ops.wm.save_as_mainfile(filepath=str(folder/(liv['id']+'.blend')),compress=True)
 bpy.ops.export_scene.gltf(filepath=str(ex/(liv['id']+'.glb')),export_format='GLB',export_extras=True,export_yup=True,export_cameras=False,export_lights=False,export_animations=False)
 print('EXPORTED',key,liv['id'],'missing textures',sorted(missing),flush=True)

args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
for key,cfg in CONFIGS.items():
 for liv in cfg['liveries']:
  if not args or (key in args and (len(args)==1 or liv['id'] in args)):run(key,dict(liv))
