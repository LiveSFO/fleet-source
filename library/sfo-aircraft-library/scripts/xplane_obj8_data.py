"""Read OBJ8 geometry and declarative transforms; execute no simulator code.
Basis: Laminar Research OBJ8 File Format Specification, 2025 revision.
"""
import re,math
from mathutils import Matrix,Vector
C=Matrix(((0,0,1,0),(1,0,0,0),(0,1,0,0),(0,0,0,1)))
def read_obj8(path):
 lines=[l.strip() for l in path.read_text(errors='strict').splitlines()];vertices=[];indices=[];textures={}
 for line in lines:
  t=line.split()
  if not t:continue
  if t[0]=='VT':vertices.append([float(v) for v in t[1:9]])
  elif t[0] in ['IDX','IDX10']:indices.extend(map(int,t[1:]))
  elif t[0] in ['TEXTURE','TEXTURE_NORMAL','TEXTURE_LIT']:textures[t[0]]=' '.join(t[1:])
 # Each nesting frame owns an ordered transform list and visibility conditions.
 stack=[{'transforms':[],'conditions':[]}];batches=[];lights=[];current=None
 for lineno,line in enumerate(lines):
  t=line.split()
  if not t:continue
  cmd=t[0]
  if cmd=='ANIM_begin':stack.append({'transforms':[],'conditions':[]})
  elif cmd=='ANIM_end':assert len(stack)>1;stack.pop()
  elif cmd=='ANIM_rotate_begin':current={'type':'rotate','axis':list(map(float,t[1:4])),'property':t[4],'keys':[]};stack[-1]['transforms'].append(current)
  elif cmd=='ANIM_trans_begin':current={'type':'translate','property':t[1],'keys':[]};stack[-1]['transforms'].append(current)
  elif cmd in ['ANIM_rotate_key','ANIM_trans_key']:current['keys'].append([float(v) for v in t[1:]])
  elif cmd in ['ANIM_rotate_end','ANIM_trans_end']:current=None
  elif cmd=='ANIM_rotate':
   a=list(map(float,t[1:6]));prop=t[8] if len(t)>8 else '';keys=[[float(t[6]),a[3]],[float(t[7]),a[4]]] if len(t)>7 else [[0,a[3]]];stack[-1]['transforms'].append({'type':'rotate','axis':a[:3],'property':prop,'keys':keys})
  elif cmd=='ANIM_trans':
   v=list(map(float,t[1:7]));prop=t[9] if len(t)>9 else '';keys=[[float(t[7]),*v[:3]],[float(t[8]),*v[3:]]] if len(t)>8 else [[0,*v[:3]]];stack[-1]['transforms'].append({'type':'translate','property':prop,'keys':keys})
  elif cmd in ['ANIM_hide','ANIM_show']:stack[-1]['conditions'].append({'type':cmd,'low':float(t[1]),'high':float(t[2]),'property':t[3]})
  elif cmd=='TRIS':
   first,count=map(int,t[1:3]);ids=indices[first:first+count];assert len(ids)==count and count%3==0
   batches.append({'line':lineno+1,'firstIndex':first,'indices':ids,'transforms':[q for s in stack for q in s['transforms']],'conditions':[q for s in stack for q in s['conditions']]})
  elif cmd in ['LIGHT_NAMED','LIGHT_PARAM']:lights.append({'command':cmd,'name':t[1],'position':list(map(float,t[2:5])),'rgb':list(map(float,t[5:8])) if cmd=='LIGHT_PARAM' else [1,1,1],'transforms':[q for s in stack for q in s['transforms']],'conditions':[q for s in stack for q in s['conditions']]})
 assert len(stack)==1,'Unbalanced OBJ8 animation block'
 return {'vertices':vertices,'batches':batches,'textures':textures,'lights':lights}

def value_at(keys,value):
 keys=sorted(keys,key=lambda v:v[0])
 if len(keys)==1:return keys[0][1:]
 a,b=keys[:2]
 for i in range(1,len(keys)):
  a,b=keys[i-1:i+1]
  if value<=b[0]:break
 t=(value-a[0])/(b[0]-a[0]) if b[0]!=a[0] else 0
 return [x+(y-x)*t for x,y in zip(a[1:],b[1:])]

def control_for(prop):
 if '/gear/deploy_ratio' in prop:return 'gear'
 if 'thrust_reverser_deploy_ratio' in prop:return 'reversers'
 if '/flap' in prop or '/slat' in prop:return 'flaps'
 if '/spoiler' in prop or prop.endswith('custom_slider_ratio[12]'):return 'spoilers'
 if 'engine_rotation_angle' in prop:return 'fans'
 return None

def rest_pose(batch):
 matrix=Matrix.Identity(4);motions=[]
 for tr in batch['transforms']:
  prop=tr['property'];control=control_for(prop);rest=1 if control=='gear' else 0;values=value_at(tr['keys'],rest);before=matrix.copy()
  if tr['type']=='rotate':
   axis=Vector(tr['axis']);axis.normalize();matrix=matrix@Matrix.Rotation(math.radians(values[0]),4,axis)
   if control:
    center=C@before.translation;global_axis=C.to_3x3()@(before.to_3x3()@axis)
    # Public controller uses glTF Y-up; importer geometry is Blender Z-up.
    to_gltf=lambda v:[v.x,v.z,-v.y]
    keys=[[k[0],k[1]-values[0]] for k in sorted(tr['keys'])];scale=max(abs(k[0]) for k in keys) if control in ['flaps','spoilers'] and '_deg' in prop else 1
    motions.append({'control':control,'type':'spin' if control=='fans' else 'rotate','property':prop,'inputScale':scale,'axis':to_gltf(global_axis),'center':to_gltf(center),'factor':1,'offset':0,'interpolation':keys,'min':None,'max':None,'spinDirection':1 if len(keys)<2 or keys[-1][1]>=keys[0][1] else -1})
  else:
   delta=Vector(values);matrix=matrix@Matrix.Translation(delta)
   if control:
    ks=sorted(tr['keys']);direction=Vector(ks[-1][1:])-Vector(ks[0][1:]);length=direction.length
    if length>1e-8:
     axis=C.to_3x3()@(before.to_3x3()@direction.normalized());keys=[[k[0],(Vector(k[1:])-delta).dot(direction.normalized())] for k in ks];scale=max(abs(k[0]) for k in ks) if control in ['flaps','spoilers'] and '_deg' in prop else 1
     motions.append({'control':control,'type':'translate','property':prop,'inputScale':scale,'axis':[axis.x,axis.z,-axis.y],'center':[0,0,0],'factor':1,'offset':0,'interpolation':keys,'min':None,'max':None})
 return C@matrix,motions
