"""Explicit exterior variant construction; no uniform fuselage stretching."""
import re,bmesh,bpy
from mathutils import Vector
import math

def remap_span(value, stations):
 """Symmetric transverse station correction, with its local derivative."""
 sign=-1 if value<0 else 1
 y=abs(value)
 for (a,b),(c,d) in zip(stations,stations[1:]):
  if y<=c:
   slope=(d-b)/(c-a)
   return sign*(b+(y-a)*slope),slope
 a,b=stations[-2];c,d=stations[-1];slope=(d-b)/(c-a)
 return sign*(d+(y-c)*slope),slope

def add_a330_neo_tips(objects):
 """Build curved neo tip shells at the retained outer-wing attachment."""
 material=bpy.data.materials.new('A330neo painted wingtip')
 material.use_nodes=True
 shader=material.node_tree.nodes.get('Principled BSDF')
 shader.inputs['Base Color'].default_value=(.64,.67,.69,1)
 shader.inputs['Metallic'].default_value=.18
 shader.inputs['Roughness'].default_value=.29
 stations=[(29.00,13.30,15.84,1.05,.055),
           (29.54,13.69,16.03,1.17,.050),
           (30.08,14.12,16.23,1.38,.043),
           (30.61,14.67,16.43,1.73,.035),
           (31.12,15.28,16.65,2.23,.027),
           (31.54,15.90,16.89,2.86,.018),
           (31.84,16.48,17.09,3.48,.010),
           (32.00,16.97,17.20,3.94,.003)]
 for side in (-1,1):
  vertices=[];uv=[]
  for y,leading,trailing,z,thickness in stations:
   for index in range(33):
    angle=math.tau*index/32
    chord=.5-.5*math.cos(angle)
    vertices.append((leading+(trailing-leading)*chord,
                     side*(y+thickness*.7*math.sin(angle)),
                     z+thickness*math.sin(angle)))
    uv.append((chord,(y-29)/3))
  faces=[(ring*33+j,ring*33+j+1,(ring+1)*33+j+1,(ring+1)*33+j)
         for ring in range(len(stations)-1) for j in range(32)]
  if side<0:faces=[tuple(reversed(face)) for face in faces]
  name='A330neo authored wingtip '+str(side)
  mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces)
  mesh.materials.append(material);layer=mesh.uv_layers.new()
  for face in mesh.polygons:
   face.use_smooth=True
   for loop in face.loop_indices:layer.data[loop].uv=uv[mesh.loops[loop].vertex_index]
  mesh.update()
  ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob)
  ob.parent=objects[0].parent
  ob['sourceName']=name;ob['sourcePartId']=name
  ob['sourceModel']='Original A330neo exterior detail'
  objects.append(ob)
 return {'span':64.0,'attachmentStation':29.0,
         'basis':'Original curved shells following A330neo exterior proportions and the Airbus 64.00 m published span. Detailed airfoil sections remain illustrative.'}

def extend_a350(objects,motions,spec):
 """Insert the two A350-1000 cabin sections and reconstruct its main bogies."""
 cabin=next(ob for ob in objects if ob['sourceName']=='cabin.windows')
 root=cabin.parent
 added=[]
 def copy_pane(pane):
  low,high=pane['template']
  for side in (-1,1):
   polys=[p for p in cabin.data.polygons if all(low<=cabin.data.vertices[i].co.x<=high
             and side*cabin.data.vertices[i].co.y>2.7 for i in p.vertices)]
   assert polys,('Cannot isolate A350 cabin pane',pane,side)
   ids=sorted({i for p in polys for i in p.vertices})
   indices={index:i for i,index in enumerate(ids)}
   coords=[cabin.data.vertices[i].co.copy() for i in ids]
   center=(min(v.x for v in coords)+max(v.x for v in coords))/2
   for ix,x in enumerate(pane['stations']):
    name=f'Added cabin pane {side} {pane["station"]} {ix+1}'
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata([(v.x-center+x,v.y+side*.006,v.z) for v in coords],[],
                     [tuple(indices[i] for i in p.vertices) for p in polys])
    mesh.update()
    mesh.materials.append(cabin.data.materials[0])
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);obj.parent=root
    obj['sourcePartId']=name;obj['sourceName']=name;obj['sourceModel']='A350-1000 original exterior detail'
    added.append(obj)
 for plug in spec['plugs']:copy_pane(plug)
 def longitudinal(x,wing=False):
  return x+sum(q['length'] for q in spec['plugs'] if x>=q['station'] and not (wing and q['aft']))
 wing_part=re.compile(r'wing|aileron|slat|flap|spoiler|pylon|^eng\.|^engine|fan|nacelle',re.I)
 for ob in objects:
  wing=bool(wing_part.search(ob['sourceName']))
  for v in ob.data.vertices:v.co.x=longitudinal(v.co.x,wing)
  ob.data.update()
 for m in motions:
  m['center'][0]=longitudinal(m['center'][0],m['control'] in ('flaps','spoilers','fans','reversers'))
 for side in ('left','right'):
  front=next(o for o in objects if o['sourceName']==f'tyres.{side}.front')
  rear=next(o for o in objects if o['sourceName']==f'tyres.{side}.back')
  def axle(ob):
   xs=[v.co.x for v in ob.data.vertices]
   return (min(xs)+max(xs))/2
  start,end=axle(front),axle(rear)
  pivot=(start+end)/2
  name=f'tyres.{side}.center'
  mid=front.copy();mid.data=front.data.copy();mid.name=name;bpy.context.collection.objects.link(mid)
  mid['sourceName']=name;mid['sourcePartId']=front['sourcePartId']+':center'
  for obj,target,origin in ((front,pivot-1.45,start),(mid,pivot,start),(rear,pivot+1.45,end)):
   for v in obj.data.vertices:v.co.x+=target-origin
   obj.data.update()
  for m in motions:
   if front['sourcePartId'] in m['targetPartIds']:
    m['targetPartIds'].append(mid['sourcePartId']);m['targets'].append(name)
  for ob in objects:
   if ob['sourceName'] not in (f'{side}.strut.low',f'{side}.main.door'):continue
   for v in ob.data.vertices:v.co.x=pivot+(v.co.x-pivot)*1.25
   ob.data.update()
  added.append(mid)
 objects.extend(added)
 return {'insertedBarrels':spec['plugs'],'newPaneMeshes':len(added)-2,
         'mainGear':'Two three-axle bogies; original strut retraction pivots drive the additional axle meshes',
         'basis':spec['basis']}


def construct_variant(objects,motions,cfg):
 record={};plugs=cfg.get('fuselagePlugRemoval',[])
 if cfg.get('spanStations'):
  spec=cfg['spanStations'];stations=spec['stations']
  assert stations[0]==[0,0] and all(c>a and d>b for (a,b),(c,d) in zip(stations,stations[1:]))
  for ob in objects:
   for v in ob.data.vertices:v.co.y=remap_span(v.co.y,stations)[0]
   ob.data.update()
  for m in motions:
   m['center'][2],slope=remap_span(m['center'][2],stations)
   axis=Vector(m['axis']);axis.z*=slope
   m['axis']=list(axis.normalized())
  record['spanStations']={**spec,'method':'Piecewise transverse station correction, preserving longitudinal/vertical sections. Meshes and mechanism pivots use the same map.'}
 if cfg.get('a330NeoTips'):
  record['a330NeoTips']=add_a330_neo_tips(objects)
 if cfg.get('a350Extension'):
  record['a350Extension']=extend_a350(objects,motions,cfg['a350Extension'])
 if cfg.get('enhancedWingtip'):
  # Embraer APM fig. 2.2 specifies the enhanced tip envelope. Keep the
  # attachment seam and entire inboard wing fixed; remodel only the tip.
  spec=cfg['enhancedWingtip'];tips=[o for o in objects if re.fullmatch(r'winglet\.[lr]',o['sourceName'],re.I)]
  assert len(tips)==2,'Enhanced E175 requires the two distinct source winglets'
  ground=min(v.co.z for o in objects for v in o.data.vertices);nose=min(v.co.x for o in objects for v in o.data.vertices)
  length=max(v.co.x for o in objects for v in o.data.vertices)-nose
  xs=length/cfg['dimensions']['length'];changes=[]
  for ob in tips:
   coords=[v.co.copy() for v in ob.data.vertices];lo=min(v.z for v in coords);hi=max(v.z for v in coords);side=1 if sum(v.y for v in coords)>0 else -1
   top=[v for v in coords if v.z>hi-.05];old_y=max(abs(v.y) for v in coords);old_x=max(v.x for v in top)
   delta_y=spec['span']/2-old_y;delta_z=ground+spec['tipHeight']-hi;delta_x=nose+spec['tipAftDistance']*xs-old_x
   for v in ob.data.vertices:
    t=max(0,min(1,(v.co.z-lo)/(hi-lo)))
    v.co.y+=side*delta_y*t;v.co.z+=delta_z*t;v.co.x+=delta_x*t
   ob.data.update();changes.append({'part':ob['sourceName'],'tipDelta':[delta_x,side*delta_y,delta_z],'rootUnchanged':True})
  record['enhancedWingtip']={'changes':changes,'basis':spec['basis'],'method':'Remodeled source airfoil tip with fixed attachment seam, manufacturer span, standing tip height and plan-view aft station. Requires three-view shape review; not factory CAD.'}
 if plugs:
  def remap(x):
   for plug in plugs:
    a,b=plug['range'];width=b-a
    if plug['side']=='forward':x=x+width if x<=a else b if x<b else x
    else:x=x if x<=a else a if x<b else x-width
   return x
  fixed=re.compile(cfg['variantFixedParts'],re.I)
  changed=[]
  for ob in objects:
   if fixed.search(ob['sourceName']) or fixed.search(ob.get('sourceGroups','')):continue
   touched=False
   for v in ob.data.vertices:
    new=remap(v.co.x)
    if abs(new-v.co.x)>1e-7:v.co.x=new;touched=True
   if touched:
    bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    flat=[f for f in bm.faces if f.calc_area()<1e-9]
    if flat:bmesh.ops.delete(bm,geom=flat,context='FACES')
    loose=[v for v in bm.verts if not v.link_faces]
    if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free();ob.data.update();changed.append(ob['sourceName'])
  for m in motions:
   if m['control'] not in ['flaps','spoilers','fans','reversers']:m['center'][0]=remap(m['center'][0])
  record['fuselagePlugs']={'removed':plugs,'affectedParts':changed,'basis':cfg['variantBasis']}
 if cfg.get('engineCenterline'):
  changes=[]
  for prefix in ['n1.','n2.']:
   fan=next((o for o in objects if o['sourceName']==prefix+'fan'),None)
   if fan is None:continue
   center=sum((v.co for v in fan.data.vertices),Vector())/len(fan.data.vertices);target=cfg['engineCenterline']*(1 if center.y>0 else -1);delta=target-center.y;ids=set();dx=0
   if cfg.get('engineFrontDistance'):
    nose=min(v.co.x for ob in objects for v in ob.data.vertices);front=min(v.co.x for ob in objects if ob['sourceName'].startswith(prefix) for v in ob.data.vertices);dx=nose+cfg['engineFrontDistance']-front
   for ob in objects:
    if ob['sourceName'].startswith(prefix):
     for v in ob.data.vertices:v.co.y+=delta;v.co.x+=dx
     ids.add(ob['sourcePartId'])
   for m in motions:
    if m['targetPartIds'] and set(m['targetPartIds']).issubset(ids):m['center'][2]-=delta;m['center'][0]+=dx
   changes.append({'enginePrefix':prefix,'sourceCenterline':-center.y,'targetCenterline':-target,'longitudinalShift':dx})
  record['enginePlacement']={'changes':changes,'basis':'Boeing D6-38A004 Rev K, 2.2.2/2.2.3: nacelle centerlines 4.82 m from centerline.'}
 return record
