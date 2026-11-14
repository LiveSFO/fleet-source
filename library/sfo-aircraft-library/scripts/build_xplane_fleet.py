"""Portable PBR aircraft from selected, pinned, GPL OBJ8 exterior data."""
import bpy,pathlib,json,math,re
from mathutils import Vector
from xplane_obj8_data import read_obj8,rest_pose,C,control_for

def build(base,key,cfg,liv):
 up=base/cfg['source']/'upstream'/cfg['package'];folder=base/key;ex=folder/'exports';ex.mkdir(parents=True,exist_ok=True)
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 root=bpy.data.objects.new('Aircraft',None);bpy.context.collection.objects.link(root);root['aircraft']=cfg['label'];root['livery']=liv['name'];root['units']='meters'
 objects=[];motions={};fixtures=[];maps={};triangles=0
 def material(role,texture):
  sig=(role,str(texture))
  if sig in maps:return maps[sig]
  m=bpy.data.materials.new(texture.stem+'_'+role);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.26;p.inputs['Metallic'].default_value=.1;p.inputs['Coat Weight'].default_value=.3;p.inputs['Coat Roughness'].default_value=.2
  if role in ['cockpit','cabin']:
   p.inputs['Base Color'].default_value=(.009,.018,.028,1);p.inputs['Specular IOR Level'].default_value=.25
   if role=='cockpit':m['cockpitGlazing']=True
   else:m['cabinWindow']=True;p.inputs['Emission Color'].default_value=(1,.69,.36,1);p.inputs['Emission Strength'].default_value=0
  else:
   image=bpy.data.images.load(str(texture),check_existing=True);image.pack();node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;m.node_tree.links.new(node.outputs['Color'],p.inputs['Base Color'])
   for name,socket,normal in [('normal-gltf.png','Normal',True),('metal-rough-gltf.png',None,False)]:
    pbr_folder=base/cfg['pbrTexturesFrom'] if cfg.get('pbrTexturesFrom') else folder/'generated'
    image=bpy.data.images.load(str(pbr_folder/name),check_existing=True);image.colorspace_settings.name='Non-Color';image.pack();node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=image
    if normal:
     nm=m.node_tree.nodes.new('ShaderNodeNormalMap');m.node_tree.links.new(node.outputs['Color'],nm.inputs['Color']);m.node_tree.links.new(nm.outputs['Normal'],p.inputs['Normal'])
    else:
     separate=m.node_tree.nodes.new('ShaderNodeSeparateColor');m.node_tree.links.new(node.outputs['Color'],separate.inputs['Color']);m.node_tree.links.new(separate.outputs['Green'],p.inputs['Roughness']);m.node_tree.links.new(separate.outputs['Blue'],p.inputs['Metallic'])
  maps[sig]=m;return m
 for rel in cfg['models']:
  path=up/rel;data=read_obj8(path);texture=up/liv.get('texture',str(path.parent.relative_to(up)/data['textures']['TEXTURE']));glass='glass' in path.name.lower()
  for ix,batch in enumerate(data['batches']):
   matrix,ms=rest_pose(batch);conditions=batch['conditions']
   if any('/lights/' in q['property'] for q in conditions):continue
   visible=True
   for condition in conditions:
    v=1 if control_for(condition['property'])=='gear' else 0;inside=condition['low']<=v<=condition['high']
    if condition['type']=='ANIM_hide' and inside:visible=False
    if condition['type']=='ANIM_show' and inside:visible=True
   if not visible:continue
   # Split genuine windshield and passenger glazing rather than illuminating the flight deck.
   roles={}
   for j in range(0,len(batch['indices']),3):
    ids=batch['indices'][j:j+3];center=sum((matrix@Vector(data['vertices'][i][:3]) for i in ids),Vector())/3
    role='cockpit' if glass and center.x<cfg['cockpitCutoff'] else 'cabin' if glass else 'surface';roles.setdefault(role,[]).append(ids)
   for role,faces in roles.items():
    ids=sorted({v for f in faces for v in f});remap={v:i for i,v in enumerate(ids)};verts=[matrix@Vector(data['vertices'][i][:3]) for i in ids];faces=[[remap[i] for i in reversed(face)] for face in faces]
    tire=any('tire_rotation' in t['property'] for t in batch['transforms']);controls={m['control'] for m in ms};name=('tire' if tire else 'gear-door' if 'gear' in controls and 'Maingear' not in rel else 'gear-hardware' if 'gear' in controls else role if glass else 'fan' if 'fans' in controls else 'reverser' if 'reversers' in controls else 'flap' if 'flaps' in controls else 'spoiler' if 'spoilers' in controls else path.stem)+'-'+str(ix)+'-'+role
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();uv=me.uv_layers.new()
    for poly,face in zip(me.polygons,faces):
     poly.use_smooth=True
     for loop,i in zip(poly.loop_indices,face):uv.data[loop].uv=tuple(data['vertices'][ids[i]][6:8])
    normals=[matrix.to_3x3()@Vector(data['vertices'][i][3:6]) for i in ids];me.normals_split_custom_set_from_vertices(normals);me.materials.append(material(role,texture));ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);ob.parent=root;pid=rel+':'+str(batch['line'])+':'+role;ob['sourcePartId']=pid;ob['sourceName']=name;ob['sourceModel']=rel;ob['sourceOBJ8Line']=batch['line'];objects.append(ob);triangles+=len(faces)
    for motion in ms:
     sig=json.dumps(motion,sort_keys=True)
     if sig not in motions:motions[sig]=dict(motion,targets=[],targetPartIds=[],scope='obj8',model=rel)
     motions[sig]['targets'].append(name);motions[sig]['targetPartIds'].append(pid)
  for light in data['lights']:
   if light['name'].endswith('_pm'):continue # Simulator spill duplicate of the physical fixture.
   matrix,_=rest_pose(light);p=matrix@Vector(light['position']);name=light['name'];refs=' '.join(q['property'] for q in light['conditions']);kind='beacon' if 'beacon' in name else 'strobe' if 'strobe' in name else 'nav' if 'nav' in name else 'landing' if 'landing' in name else 'taxi' if 'taxi' in name else 'logo' if '/logo' in refs else 'winglight' if '/winginsp' in refs else 'turnoff' if '/tl_' in refs else None
   if not kind:continue
   rgb=light['rgb'];color='red' if kind=='beacon' or kind=='nav' and rgb[0]>rgb[1]*1.5 else 'green' if kind=='nav' and rgb[1]>rgb[0]*1.5 else 'white';spec={'name':name+' '+str(len(fixtures)),'kind':kind,'color':color,'position':[p.x,p.z,-p.y],'basis':'Primary source OBJ8 LIGHT_PARAM; source animation placement retained.'}
   if not any(q['kind']==kind and sum((a-b)**2 for a,b in zip(q['position'],spec['position']))<.01 for q in fixtures):fixtures.append(spec)
 if not objects:raise ValueError('No OBJ8 exterior geometry')
 variant={}
 if cfg.get('fuselageInsertions'):
  from fleet_xplane_variants import insert_barrels
  variant=insert_barrels(objects,list(motions.values()),fixtures,root,cfg['fuselageInsertions'])
 if liv.get('authoredPaint'):
  from fleet_authored_paint import apply_authored_paint
  variant['authoredPaint']=apply_authored_paint(base,key,liv,objects)
 if liv.get('operatorFinishes'):
  from fleet_paint_projection import apply_operator_finishes
  variant['operatorFinishParts']=apply_operator_finishes(base,key,liv,objects)
 if liv.get('registrationDecals'):
  from fleet_xplane_variants import fit_registration_decals
  variant['registrationDecals']=fit_registration_decals(base,objects,root,liv['registrationDecals'])
 lo=[min(v.co[k] for ob in objects for v in ob.data.vertices) for k in range(3)];hi=[max(v.co[k] for ob in objects for v in ob.data.vertices) for k in range(3)];raw={'length':hi[0]-lo[0],'span':hi[1]-lo[1]};sx=cfg['dimensions']['length']/raw['length'];sy=cfg['dimensions']['span']/raw['span'];assert max(abs(sx-1),abs(sy-1))<.05,('OBJ8 variant envelope mismatch',raw)
 for ob in objects:
  for v in ob.data.vertices:v.co.x*=sx;v.co.y*=sy
  ob.data.update()
 for m in motions.values():m['center'][0]*=sx;m['center'][2]*=sy
 for q in fixtures:q['position'][0]*=sx;q['position'][2]*=sy
 lo[0]*=sx;hi[0]*=sx;lo[1]*=sy;hi[1]*=sy
 internal=[o for o in objects if 'Maingear' in o['sourceModel'] and any(o['sourcePartId'] in m['targetPartIds'] for m in motions.values() if m['control']=='gear')]
 for ob in internal:ob['gearInternal']=True
 rig={'aircraft':key,'label':cfg['label'],'livery':liv,'referenceDimensions':cfg['dimensions'],'axes':'X aft; Y up; Z port','bounds':{'min':[lo[0],lo[2],-hi[1]],'max':[hi[0],hi[2],-lo[1]]},'motions':list(motions.values()),'gearInternalParts':[o['sourceName'] for o in internal],'gearInternalPartIds':[o['sourcePartId'] for o in internal],'missingTextures':[],'provenance':cfg['source'],'sourceOBJ8':cfg['models'],'capabilities':sorted({m['control'] for m in motions.values()}),'reviewStatus':'build-awaiting-validation','minimumCabinSpanRatio':.2,'fidelityNotes':cfg.get('notes',[]),'envelopeCalibration':{'rawDimensions':raw,'axisScale':[sx,1,sy]},'reviewPoints':{'cockpit':[lo[0]+3,2.2,0],'door':[lo[0]+5.2,1.8,1.25],'engine':[6,2.2,2.4],'gear':[-11.6,-.9,0],'wing':[0,.8,7]},'unresolvedMotions':[]}
 if variant:rig['variantConstruction']=variant
 (folder/'lights.json').write_text(json.dumps(fixtures,indent=2)+'\n');(ex/(liv['id']+'.rig.json')).write_text(json.dumps(rig,indent=2)+'\n');bpy.context.scene.unit_settings.system='METRIC';bpy.ops.wm.save_as_mainfile(filepath=str(folder/(liv['id']+'.blend')),compress=True,copy=True);bpy.ops.export_scene.gltf(filepath=str(ex/(liv['id']+'.glb')),export_format='GLB',export_extras=True,export_yup=True,export_cameras=False,export_lights=False,export_animations=False,export_tangents=True);from fix_gltf_tangents import repair
 repair(ex/(liv['id']+'.glb'))
 print('OBJ8 EXPORTED',key,liv['id'],triangles,'triangles',raw,'controls',rig['capabilities'],flush=True)
