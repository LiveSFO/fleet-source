"""Original airline paint layout, measured in meters on the actual exterior.
Vector artwork is rasterized separately; this code retains the target UV atlases.
"""
import re,bpy,numpy as np
from fleet_paint_projection import triangles,points,bounds,frame,raster,sample,image_array,write_png

def apply_authored_paint(base,key,liv,objects):
 cfg=liv.get('authoredPaint')
 if not cfg:return None
 body_pattern=re.compile(cfg.get('bodyPartPattern',r'^fuselage$|^body$|^door[FLR0-9]+$|^door\.[FA][LR]O$|^cdoor\.(fwd|aft)O$|^belly$'),re.I)
 fin_pattern=re.compile(cfg.get('finPartPattern',r'^vstab|^v-stab|^fin$|^rudder|^Tail$'),re.I)
 tex_pattern=re.compile(cfg.get('texturePattern','.*'),re.I)
 bodyparts=[o for o in objects if body_pattern.search(o['sourceName'])];finparts=[o for o in objects if fin_pattern.search(o['sourceName'])]
 assert bodyparts and (finparts or cfg.get('noSeparateFin')),'Authoring needs actual body and fin geometry'
 if cfg.get('isolatePartTextures'):
  # Some source caps reuse the full body UV square. Each part needs its own
  # paint map so a small cap cannot erase lettering on the fuselage.
  for ob in dict.fromkeys(bodyparts+finparts):
   for index,original in enumerate(list(ob.data.materials)):
    material=original.copy()
    shader=material.node_tree.nodes.get('Principled BSDF')
    base_input=shader.inputs['Base Color']
    if base_input.is_linked and base_input.links[0].from_node.type=='TEX_IMAGE':
     node=base_input.links[0].from_node
     node.image=node.image.copy()
    ob.data.materials[index]=material
 f=frame(objects);blo,bhi=bounds(bodyparts);flo,fhi=bounds(finparts or bodyparts);bodycenter=cfg.get('bodyCenterZ',(blo[2]+bhi[2])/2)
 cache={}
 def image(path):
  if path not in cache:cache[path]=image_array(bpy.data.images.load(str(base/path),check_existing=True))
  return cache[path]
 def decal(rgb,p,graphic,is_fin):
  if is_fin:
   x=(p[:,0]-flo[0])/max(fhi[0]-flo[0],.001);z=(p[:,2]-flo[2])/max(fhi[2]-flo[2],.001)
   box=graphic['box']
  else:
   x=(p[:,0]-f['nose'])/f['length'];z=p[:,2]-bodycenter;box=graphic['box']
  u=(x-box[0])/(box[2]-box[0]);v=(z-box[1])/(box[3]-box[1])
  uv=np.stack((u if graphic.get('sameStationOnBothSides') else np.where(p[:,1]>0,1-u,u),v),1)
  inside=(u>=0)&(u<=1)&(v>=0)&(v<=1)
  if not inside.any():return
  d=sample(image(graphic['image']),uv[inside])
  if graphic.get('oppositeSideImage'):
   opposite=p[inside,1]>0
   d[opposite]=sample(image(graphic['oppositeSideImage']),uv[inside][opposite])
  alpha=d[:,3:4]
  if graphic.get('colorSRGB') is not None:d[:,:3]=np.array(graphic['colorSRGB'])/255
  rgb[inside]=rgb[inside]*(1-alpha)+d[:,:3]*alpha
 def paint(p,is_fin,underlay):
  color=np.array(cfg.get('finColorSRGB' if is_fin else 'bodyColorSRGB',[248,249,248]),np.float32)/255;rgb=underlay.copy() if cfg.get('preserveBasePaint') else np.broadcast_to(color,(len(p),3)).copy()
  # Geometric masks are original artwork, expressed in measured side coordinates.
  x=(p[:,0]-flo[0])/max(fhi[0]-flo[0],.001) if is_fin else (p[:,0]-f['nose'])/f['length']
  z=(p[:,2]-flo[2])/max(fhi[2]-flo[2],.001) if is_fin else p[:,2]-bodycenter
  for band in cfg.get('finBands' if is_fin else 'bodyBands',[]):
   v=z-band.get('slope',0)*x;mask=(v>=band['range'][0])&(v<=band['range'][1])&(x>=band.get('xRange',[0,1])[0])&(x<=band.get('xRange',[0,1])[1]);rgb[mask]=np.array(band['colorSRGB'])/255
  for polygon in cfg.get('finPolygons' if is_fin else 'bodyPolygons',[]):
   outline=polygon['points'];inside=np.zeros(len(x),dtype=bool)
   for (xa,za),(xb,zb) in zip(outline,outline[1:]+outline[:1]):
    if za==zb:continue
    inside^=((za>z)!=(zb>z))&(x<xa+(xb-xa)*(z-za)/(zb-za))
   rgb[inside]=np.asarray(polygon['colorSRGB'])/255
  for graphic in cfg.get('finGraphics' if is_fin else 'bodyGraphics',[]):decal(rgb,p,graphic,is_fin)
  return rgb
 groups={};targets=[]
 for ob in bodyparts+([] if cfg.get('preserveFinPaint') else finparts):
  is_fin=ob in finparts;materials=set()
  for mat in ob.data.materials:
   if not mat or mat.get('cockpitGlazing') or (mat.get('cabinWindow') and not mat.get('cabinMask')):continue
   sh=mat.node_tree.nodes.get('Principled BSDF');inp=sh.inputs['Base Color'];node=inp.links[0].from_node if inp.is_linked else None
   if node and node.type=='TEX_IMAGE' and tex_pattern.search(node.image.name):groups.setdefault(node.image,{})[mat]=node;materials.add(mat)
  if materials:targets.append((ob,is_fin,materials))
 if not targets:raise ValueError('No textured body matched the authored paint definition')
 out=base/key/'generated'/liv['id'];out.mkdir(parents=True,exist_ok=True);maps=[];res=cfg.get('resolution',4096)
 for index,(original,materials) in enumerate(groups.items()):
  temp=original.copy();temp.scale(res,res);color=image_array(temp,max_size=res)[:,:,:3].copy();bpy.data.images.remove(temp)
  for ob,is_fin,slots in targets:
   if not slots.intersection(materials):continue
   for xyz,uv,mat in triangles(ob):
    if mat not in materials:continue
    def write(x,y,b,xyz=xyz,is_fin=is_fin,mat=mat,uv=uv):
     rgb=paint(b@xyz,is_fin,color[y,x])
     if mat.get('cabinMask'):
      alpha=sample(image(mat['cabinMask']),b@uv)[:,:3].max(1)[:,None];rgb=rgb*(1-alpha)+np.array([.035,.065,.085])*alpha
     color[y,x]=rgb
    raster(uv,(res,res),write)
  path=out/('authored-color-'+str(index)+'.png');write_png(path,color);im=bpy.data.images.load(str(path),check_existing=False);im.pack()
  for node in materials.values():node.image=im
  maps.append(str(path.relative_to(base)))
 return {'method':'Original airline paint layout projected in physical exterior coordinates; independent destination texture atlases retained.','maps':maps,'references':cfg.get('references',[]),'artworkMetadata':cfg.get('artworkMetadata',[]),'reviewStatus':'requires-visual-review'}
