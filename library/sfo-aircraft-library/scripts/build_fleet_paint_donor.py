"""Build a paint-only Blender donor from pinned AC/XML/image data.
No upstream executable code, simulation, cockpit or source scripts are loaded.
"""
import bpy,sys,pathlib,json,shlex,re,xml.etree.ElementTree as ET
from mathutils import Matrix,Vector
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent));from ac3d_data import read_ac
BASE=pathlib.Path(__file__).resolve().parents[1]/'assets/airliners'
source,acrel,paint,output,*neutral_names=sys.argv[sys.argv.index('--')+1:]
up=BASE/'preparation'/source/'upstream';ac=up/acrel;defs,world=read_ac(ac)
paintpath=(BASE/paint[1:]) if paint.startswith('@') else up/paint
if paintpath.suffix=='.xml':
 text=ET.parse(paintpath).findtext('sim/model/livery/texture');matches=list(up.rglob(pathlib.Path(text).name));assert len(matches)==1,(text,matches);paintpath=matches[0]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
C=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)));materials={}
def walk(o,parent=Matrix.Identity(4)):
 r=o['rot'];local=Matrix([r[:3],r[3:6],r[6:9]]).to_4x4();local.translation=Vector(o['loc']);transform=parent@local
 if o['faces']:
  referenced=sorted({i for f in o['faces'] for i in f['v']});remap={v:i for i,v in enumerate(referenced)}
  me=bpy.data.meshes.new(o['name']);me.from_pydata([C@(transform@Vector(o['verts'][i])) for i in referenced],[],[[remap[i] for i in f['v']] for f in o['faces']]);me.update();ob=bpy.data.objects.new(o['name'],me);bpy.context.collection.objects.link(ob);ob['sourceName']=o['name'];ob['sourceAC']=acrel
  uv=me.uv_layers.new();slots={}
  for poly,f in zip(me.polygons,o['faces']):
   idx=f['mat'];texture=None
   if o['texture']:
    texture=paintpath if pathlib.Path(o['texture']).name in neutral_names or 'liver' in o['texture'].lower() or 'blank' in pathlib.Path(o['texture']).stem.lower() or re.fullmatch(r'737-\d+\.png',pathlib.Path(o['texture']).name,re.I) or pathlib.Path(o['texture']).name.lower() in ['paint1.png','boe.png','bca-livery.png'] else ac.parent/o['texture']
    if not texture.exists():texture=None
   mk=(idx,str(texture))
   if mk not in materials:
    md=defs[idx];mat=bpy.data.materials.new(md['name']);mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*md['rgb'],1)
    if texture:
     image=bpy.data.images.load(str(texture),check_existing=True);image.pack();node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;mat.node_tree.links.new(node.outputs['Color'],p.inputs['Base Color'])
    materials[mk]=mat
   if mk not in slots:slots[mk]=len(slots);me.materials.append(materials[mk])
   poly.material_index=slots[mk]
   for i,coord in zip(poly.loop_indices,f['uv']):uv.data[i].uv=(coord[0]*o['texrep'][0]+o['texoff'][0],coord[1]*o['texrep'][1]+o['texoff'][1])
 for child in o['children']:walk(child,transform)
walk(world);path=BASE/output;path.parent.mkdir(parents=True,exist_ok=True);bpy.ops.wm.save_as_mainfile(filepath=str(path));path.with_suffix('.json').write_text(json.dumps({'source':source,'geometry':acrel,'paint':str(paintpath.relative_to(BASE)),'purpose':'Paint-coordinate donor only; excluded from deliverable aircraft catalog.'},indent=2)+'\n')
