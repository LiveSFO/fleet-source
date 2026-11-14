"""Exterior freighter conversion, with a closed door fitted to actual skin.
Manufacturer dimensions constrain the opening. This is visual exterior geometry,
not a stress model, cargo handling simulation or certified door mechanism.
"""
import bpy,re,math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

def convert_cargo(objects,root,spec):
 bodies=[o for o in objects if re.search(spec.get('bodyPattern','^Fuselage$'),o['sourceName'],re.I)]
 body=max(bodies,key=lambda o:max(v.co.x for v in o.data.vertices)-min(v.co.x for v in o.data.vertices))
 paint=next(m for m in body.data.materials if m and not m.get('cockpitGlazing'))
 sealed=[]
 for ob in objects:
  if re.search(spec['sealPattern'],ob['sourceName'],re.I):
   ob.data.materials.clear();ob.data.materials.append(paint)
   for face in ob.data.polygons:face.material_index=0
   ob['sealedPassengerGlazing']=True;sealed.append(ob['sourcePartId'])
 skin=[body]+[o for o in objects if o['sourcePartId'] in sealed]
 points=[];tris=[];uvs=[]
 for ob in skin:
  offset=len(points);points.extend(v.co.copy() for v in ob.data.vertices);ob.data.calc_loop_triangles();layer=ob.data.uv_layers.active.data
  for t in ob.data.loop_triangles:
   tris.append(tuple(offset+i for i in t.vertices));uvs.append([Vector(layer[i].uv) for i in t.loops])
 bvh=BVHTree.FromPolygons(points,tris,all_triangles=True)
 nose=min(v.co.x for o in objects for v in o.data.vertices);ground=min(v.co.z for o in objects for v in o.data.vertices)
 cx=nose+spec['centerFromNose'];width=spec['width'];height=spec['height'];z0=ground+spec['sillAboveGround'];radius=.14
 def surface(x,z,offset=.003):
  p,n,i,d=bvh.ray_cast(Vector((x,-20,z)),Vector((0,1,0)),40)
  if p is None:raise ValueError('Cargo door extends beyond actual fuselage skin: '+str((x,z)))
  a,b,c=[points[j] for j in tris[i]];v0=b-a;v1=c-a;v2=p-a;d00=v0.dot(v0);d01=v0.dot(v1);d11=v1.dot(v1);den=d00*d11-d01*d01
  if abs(den)<1e-12:u=v=0
  else:u=(d11*v2.dot(v0)-d01*v2.dot(v1))/den;v=(d00*v2.dot(v1)-d01*v2.dot(v0))/den
  uv=uvs[i][0]*(1-u-v)+uvs[i][1]*u+uvs[i][2]*v;p.y-=offset
  return p,uv
 verts=[];coords=[];faces=[];n=32
 for j in range(n+1):
  z=z0+height*j/n
  for i in range(n+1):
   x=cx-width/2+width*i/n
   # Project rectangle corners onto a rounded opening perimeter.
   kx=min(max(x,cx-width/2+radius),cx+width/2-radius);kz=min(max(z,z0+radius),z0+height-radius);dx=x-kx;dz=z-kz;length=math.hypot(dx,dz)
   if length>radius:x=kx+dx*radius/length;zpoint=kz+dz*radius/length
   else:zpoint=z
   p,uv=surface(x,zpoint);verts.append(p);coords.append(uv)
 for j in range(n):
  for i in range(n):
   a=j*(n+1)+i;faces.append((a,a+1,a+n+2,a+n+1))
 mesh=bpy.data.meshes.new('Curved main deck cargo door');mesh.from_pydata(verts,[],faces);mesh.materials.append(paint);mesh.update();uv=mesh.uv_layers.new()
 for face in mesh.polygons:
  face.use_smooth=True
  for loop in face.loop_indices:uv.data[loop].uv=coords[mesh.loops[loop].vertex_index]
 ob=bpy.data.objects.new('MainDeckCargoDoor',mesh);bpy.context.collection.objects.link(ob);ob.parent=root;ob['sourceName']=ob.name;ob['sourcePartId']='original:main-deck-cargo-door';ob['sourceModel']='Original fitted freighter exterior';ob['basis']=spec['basis'];objects.append(ob)
 # A recessed-looking fine perimeter seal, fitted to the same curved surface.
 edge=list(range(n+1))+[j*(n+1)+n for j in range(1,n+1)]+[n*(n+1)+i for i in range(n-1,-1,-1)]+[j*(n+1) for j in range(n-1,0,-1)]
 rubber=bpy.data.materials.new('Cargo door perimeter seal');rubber.use_nodes=True;p=rubber.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.035,.04,.05,1);p.inputs['Roughness'].default_value=.65
 curve=bpy.data.curves.new('Fitted cargo perimeter','CURVE');curve.dimensions='3D';curve.bevel_depth=.004;curve.bevel_resolution=2;sp=curve.splines.new('POLY');sp.points.add(len(edge)-1)
 for dest,index in zip(sp.points,edge):p=verts[index].copy();p.y-=.004;dest.co=(*p,1)
 sp.use_cyclic_u=True;co=bpy.data.objects.new('MainDeckDoorSeal',curve);bpy.context.collection.objects.link(co);co.data.materials.append(rubber);co.parent=root
 bpy.context.view_layer.objects.active=co;co.select_set(True);bpy.ops.object.convert(target='MESH');co.select_set(False);co['sourceName']='MainDeckDoorSeal';co['sourcePartId']='original:main-deck-door-seal';co['sourceModel']='Original fitted freighter exterior';objects.append(co)
 return {'sealedPassengerGlazing':sealed,'mainDeckDoor':spec,'method':'Closed curved panel and 8 mm perimeter seal ray-fitted to actual fuselage triangles; source skin UV retained. Door dimensions follow Boeing drawing; nominal sill height lies within published loading-clearance range.'}
