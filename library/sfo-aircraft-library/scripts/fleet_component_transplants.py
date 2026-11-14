"""Explicit licensed component assemblies, retaining donor part IDs and hinges."""
import bpy,json,re
from mathutils import Vector

def transplant_components(base,cfg,objects,motions,root):
 records=[]
 for spec in cfg.get('componentTransplants',[]):
  remove=re.compile(spec['replacePattern'],re.I)
  remove_model=re.compile(spec.get('replaceModelPattern','.*'),re.I)
  preserved=set(spec.get('preservePartIds',[]))
  removed=[o for o in objects if remove.search(o['sourceName']) and remove_model.search(o.get('sourceModel','')) and o['sourcePartId'] not in preserved]
  removed_ids={o['sourcePartId'] for o in removed}
  for o in removed:objects.remove(o);bpy.data.objects.remove(o,do_unlink=True)
  for m in motions:m['targetPartIds']=[p for p in m['targetPartIds'] if p not in removed_ids]
  motions[:]=[m for m in motions if m['targetPartIds']]
  with bpy.data.libraries.load(str(base/spec['blend']),link=False) as (available,loaded):loaded.objects=list(available.objects)
  keep=re.compile(spec['partPattern'],re.I)
  keep_model=re.compile(spec.get('sourceModelPattern','.*'),re.I)
  parents=[];added=[];ids={};offsets={}
  for ob in loaded.objects:
   if not ob:continue
   if ob.type!='MESH' or not keep.search(ob.get('sourceName','')) or not keep_model.search(ob.get('sourceModel','')):
    parents.append(ob);continue
   bpy.context.collection.objects.link(ob);ob.parent=root;old=ob['sourcePartId'];new='component:'+spec['id']+':'+old;ids[old]=new;ob['sourcePartId']=new;ob['componentSource']=spec['blend']
   center_y=sum(v.co.y for v in ob.data.vertices)/len(ob.data.vertices)
   shifts=set()
   for v in ob.data.vertices:
    shift=Vector((0,0,0))
    for rule in spec.get('placements',[]):
     side_y=v.co.y if rule.get('byVertex') else center_y
     if re.search(rule['partPattern'],ob['sourceName'],re.I) and (not rule.get('side') or side_y*rule['side']>0):shift+=Vector(rule['offsetBlender'])
    v.co+=shift;shifts.add(tuple(shift))
   # Static source meshes can contain both nacelle lips. Place each disconnected
   # half correctly; moving assemblies must have one rigid transform per part.
   offsets[new]=next(iter(shifts)) if len(shifts)==1 else None
   objects.append(ob);added.append(ob['sourceName'])
  for ob in parents:bpy.data.objects.remove(ob,do_unlink=True)
  rig=json.loads((base/spec['rig']).read_text())
  for m in rig['motions']:
   targets=[ids[p] for p in m['targetPartIds'] if p in ids]
   if not targets:continue
   placements={}
   for target in targets:
    if offsets[target] is None:raise ValueError('Split a moving mesh before applying independent side placements: '+target)
    placements.setdefault(offsets[target],[]).append(target)
   for shift,parts in placements.items():
    center=[m['center'][0]+shift[0],m['center'][1]+shift[2],m['center'][2]-shift[1]]
    motions.append(dict(m,targetPartIds=parts,center=center,
                        scope='component:'+spec['id']+':'+m.get('scope',''),
                        model=spec['blend']+' / '+m['model']))
  records.append({'id':spec['id'],'blend':spec['blend'],'removedParts':len(removed),'addedParts':added,'basis':spec['basis']})
 return records
