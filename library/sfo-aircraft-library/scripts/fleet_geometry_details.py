"""Original detail additions fitted to source boundaries, using Blender data APIs."""
import re,bpy
from mathutils import Vector
import math

def add_propellers(objects,root,motions,assemblies):
 """Author solid, twisted propeller blades around measured spinner axes."""
 added=[]
 blade_material=bpy.data.materials.new('Composite propeller blade')
 blade_material.diffuse_color=(.025,.029,.034,1)
 blade_material.use_nodes=True
 shader=blade_material.node_tree.nodes.get('Principled BSDF')
 shader.inputs['Base Color'].default_value=(.025,.029,.034,1)
 shader.inputs['Roughness'].default_value=.37
 for spec in assemblies:
  origin=Vector(spec['originBlender']);radius=spec['radius']
  for blade in range(spec['blades']):
   angle=math.tau*blade/spec['blades']
   radial=Vector((0,math.cos(angle),math.sin(angle)))
   tangent=Vector((0,-math.sin(angle),math.cos(angle)))
   vertices=[];faces=[]
   for fraction in (0.12,.22,.38,.56,.73,.89,.98,1.0):
    chord=radius*(.12+.10*math.sin(math.pi*fraction))*(.3 if fraction==1 else 1)
    twist=math.radians(43-28*fraction)
    for side,skin in ((-1,-1),(1,-1),(1,1),(-1,1)):
     offset=side*chord*.5
     point=origin+radial*radius*fraction+tangent*(offset*math.cos(twist))
     point.x+=offset*math.sin(twist)+skin*.006
     vertices.append(point)
   for ring in range(7):
    for corner in range(4):
     a=ring*4+corner;b=ring*4+(corner+1)%4
     faces.append((a,b,b+4,a+4))
   faces.extend([(3,2,1,0),(28,29,30,31)])
   name=spec['name']+' blade '+str(blade+1)
   mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces)
   mesh.materials.append(blade_material);mesh.update()
   for face in mesh.polygons:face.use_smooth=True
   ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);ob.parent=root
   identity='authored-propeller:'+name
   ob['sourceName']=name;ob['sourcePartId']=identity;ob['sourceModel']='Original measured propeller assembly'
   objects.append(ob);added.append(ob)
   base=dict(property='authored/propeller',offset=0,interpolation=[],min=None,max=None,
             model=ob['sourceModel'],targets=[name],targetPartIds=[identity],
             center=[origin.x,origin.z,-origin.y])
   motions.append(dict(base,control='fans',type='spin',axis=[1,0,0],factor=1,
                       spinDirection=spec.get('spinDirection',1)))
   if spec.get('reversePitch'):
    motions.append(dict(base,control='reversers',type='rotate',factor=-42,
                        axis=[radial.x,radial.z,-radial.y]))
 return added

def add_reverser_cascades(objects,root,spec):
 """Original visual vanes, recessed inside the actual translating sleeve.
 No engine manufacturing geometry is implied by the illustrative vane section.
 """
 sleeves=[o for o in objects if re.fullmatch(spec['sleevePattern'],o['sourceName'],re.I)]
 assert sleeves,'No translating sleeve matched the cascade specification'
 material=bpy.data.materials.new('Reverser cascade titanium');material.use_nodes=True
 shader=material.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(.08,.09,.105,1);shader.inputs['Metallic'].default_value=.8;shader.inputs['Roughness'].default_value=.38
 added=[]
 for side in [-1,1]:
  pts=[v.co for o in sleeves for v in o.data.vertices if v.co.y*side>1]
  if not pts:continue
  lo=[min(v[k] for v in pts) for k in range(3)];hi=[max(v[k] for v in pts) for k in range(3)];cy=(lo[1]+hi[1])/2;cz=(lo[2]+hi[2])/2
  ry=(hi[1]-lo[1])*.455;rz=(hi[2]-lo[2])*.455;x0=lo[0]+.10;x1=x0+spec.get('openingLength',.8)
  vertices=[];faces=[]
  def quad(a,b,c,d):
   n=len(vertices);vertices.extend([a,b,c,d]);faces.append((n,n+1,n+2,n+3))
  def point(x,t,depth=0):return (x,cy+(ry+depth)*math.cos(t),cz+(rz+depth)*math.sin(t))
  n=64;step=math.tau/n
  for j in range(n):
   t=j*step
   if math.sin(t)>.92:continue # pylon interruption
   # Circumferential ribs plus angled, finite-depth turning vanes.
   quad(point(x0,t-.008),point(x1,t-.008),point(x1,t+.008),point(x0,t+.008))
   for row in range(9):
    x=x0+(x1-x0)*row/9
    quad(point(x,t+.012),point(x+.032,t+.012,-.026),point(x+.032,t+step-.012,-.026),point(x,t+step-.012))
   for x in [x0,x1]:quad(point(x,t,-.005),point(x+.024,t,-.005),point(x+.024,t+step,-.005),point(x,t+step,-.005))
  mesh=bpy.data.meshes.new('Fitted cascade vanes');mesh.from_pydata(vertices,[],faces);mesh.materials.append(material);mesh.update()
  ob=bpy.data.objects.new('FittedReverserCascade'+str(side),mesh);bpy.context.collection.objects.link(ob);ob.parent=root
  ob['sourceName']=ob.name;ob['sourceModel']='Original exterior detail';ob['sourcePartId']='original:cascade:'+str(side);ob['basis']='Illustrative turning vanes recessed to 91% of the source sleeve envelope; static vanes uncovered by sleeve travel.';added.append(ob)
 return added

def fill_door_windows(objects,root,material):
 added=[];existing=[]
 for ob in objects:
  if any(m.get('cabinWindow') for m in ob.data.materials):existing.extend(Vector((v.co.x,v.co.z,-v.co.y)) for v in ob.data.vertices)
 for door in list(objects):
  name=door['sourceName']
  if not re.search(r'door|^entry[1-8][lr]',name,re.I) or re.search(r'gear|cargo|inner|\.in$|hinge|actuator|rod|lock|shadow|bay|rat',name,re.I):continue
  verts=[Vector((v.co.x,v.co.z,-v.co.y)) for v in door.data.vertices]
  if not verts:continue
  lo=[min(v[k] for v in verts) for k in range(3)];hi=[max(v[k] for v in verts) for k in range(3)]
  if hi[1]-lo[1]<.8 or hi[0]-lo[0]>.0+2:continue
  edges={}
  for p in door.data.polygons:
   ids=list(p.vertices)
   for a,b in zip(ids,ids[1:]+ids[:1]):e=tuple(sorted((a,b)));edges[e]=edges.get(e,0)+1
  graph={}
  for (a,b),count in edges.items():
   if count==1:graph.setdefault(a,set()).add(b);graph.setdefault(b,set()).add(a)
  pending=set(graph)
  while pending:
   seed=pending.pop();component={seed};stack=[seed]
   while stack:
    for n in graph[stack.pop()]:
     if n in pending:pending.remove(n);component.add(n);stack.append(n)
   if len(component)<4 or any(len(graph[n])!=2 for n in component):continue
   points=[verts[n] for n in component];center=sum(points,Vector())/len(points);span=[max(v[k] for v in points)-min(v[k] for v in points) for k in range(3)]
   if not (.055<span[0]<.7 and .07<span[1]<.7 and span[2]<.5 and .35<span[0]/span[1]<1.3 and center.y>lo[1]+.42*(hi[1]-lo[1])):continue
   if any((v-center).length<.22 for v in existing):continue
   # Retain exact hole perimeter/curvature; only offset by 2 mm to avoid seams.
   side=1 if center.z>0 else -1;points.sort(key=lambda v:math.atan2(v.y-center.y,v.x-center.x));allpoints=[center]+points
   for v in allpoints:v.z+=side*.002
   vs=[(v.x,-v.z,v.y) for v in allpoints];count=len(points)
   faces=[((0,i+1,(i+1)%count+1) if side==1 else (0,(i+1)%count+1,i+1)) for i in range(count)]
   me=bpy.data.meshes.new(name+'WindowPane');me.from_pydata(vs,[],faces);me.materials.append(material);me.update()
   ob=bpy.data.objects.new(name+'WindowPane',me);bpy.context.collection.objects.link(ob);ob.parent=root
   ob['sourceName']=name+'WindowPane';ob['sourceModel']=door['sourceModel'];ob['sourcePartId']=door['sourcePartId']+':door-pane';ob['cabinDoorWindow']=True;ob['sourceParentPartId']=door['sourcePartId'];added.append(ob)
 return added

def fill_cockpit_openings(objects,root,material,kind='cockpit'):
 """Close actual windshield boundary loops, preserving the source cutout outline."""
 added=[];diagnostics=[]
 allpoints=[v.co for ob in objects for v in ob.data.vertices]
 xmin=min(v.x for v in allpoints);xmax=max(v.x for v in allpoints);length=xmax-xmin
 for body in objects:
  name=body['sourceName']
  if not re.search('fuselage|^body|^nose',name,re.I) or re.search('door|gear|light|inner|inside|cargo|wheel',name,re.I):continue
  # Weld coincident AC seam vertices for topology inspection only.
  ids={};points=[];remap={}
  for v in body.data.vertices:
   key=tuple(round(c,5) for c in v.co)
   if key not in ids:ids[key]=len(points);points.append(v.co.copy())
   remap[v.index]=ids[key]
  edges={}
  for p in body.data.polygons:
   indices=[remap[i] for i in p.vertices]
   for a,b in zip(indices,indices[1:]+indices[:1]):
    if a!=b:
     edge=tuple(sorted((a,b)));edges[edge]=edges.get(edge,0)+1
  graph={}
  for (a,b),count in edges.items():
   if count==1:graph.setdefault(a,set()).add(b);graph.setdefault(b,set()).add(a)
  pending=set(graph)
  while pending:
   seed=pending.pop();component={seed};stack=[seed]
   while stack:
    for n in graph[stack.pop()]:
     if n in pending:pending.remove(n);component.add(n);stack.append(n)
   if len(component)<4 or any(len(graph[n])!=2 for n in component):continue
   ring=[seed];previous=None;current=seed
   while True:
    nxt=next(n for n in graph[current] if n!=previous)
    if nxt==seed:break
    ring.append(nxt);previous,current=current,nxt
   verts=[points[i] for i in ring];center=sum(verts,Vector())/len(verts);spans=[max(v[i] for v in verts)-min(v[i] for v in verts) for i in range(3)]
   if kind=='cockpit' and center.x>xmin+.08*length:continue
   body_mid=(min(v.z for v in points)+max(v.z for v in points))/2
   if center.z<body_mid:continue
   diagnostics.append({'body':name,'center':[center.x,center.z,-center.y],'span':[spans[0],spans[2],spans[1]]})
   if kind=='cockpit':
    if not (.15<spans[0]<3.5 and .22<spans[2]<1.55 and spans[1]<4.5):continue
   else:
    if not (.12<spans[0]<.8 and .15<spans[2]<.85 and spans[1]<.6 and .35<spans[0]/spans[2]<1.3):continue
   # Source opening, not an invented placement. The fan retains every boundary vertex.
   coords=[center]+verts;faces=[(0,i+1,(i+1)%len(verts)+1) for i in range(len(verts))]
   me=bpy.data.meshes.new('FittedWindshield' if kind=='cockpit' else 'FittedCabinPane');me.from_pydata(coords,[],faces);me.materials.append(material);me.update()
   ob=bpy.data.objects.new('FittedWindshield',me);bpy.context.collection.objects.link(ob);ob.parent=root
   ob['sourceName']='FittedWindshield' if kind=='cockpit' else 'FittedCabinPane';ob['sourceModel']=body['sourceModel'];ob['sourcePartId']=body['sourcePartId']+':'+kind+'-pane-'+str(len(added));ob[kind+'OpeningRepair']=True
   added.append(ob)
 return added,diagnostics
