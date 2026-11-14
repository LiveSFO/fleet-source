"""Data-only surface paint transfer through fuselage/fin/nacelle coordinates.
Rasterization retains the target's UVs and geometry. No source code is executed.
"""
import bpy,pathlib,re,math,zlib,struct,binascii
import numpy as np

def write_png(path,pixels):
 a=np.uint8(np.clip(np.flipud(pixels),0,1)*255+.5);h,w,c=a.shape
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',binascii.crc32(kind+data)&0xffffffff)
 raw=b''.join(b'\0'+row.tobytes() for row in a)
 path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6 if c==4 else 2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,6))+chunk(b'IEND',b''))

def raster(uv,resolution,callback):
 """Rasterize pixel centers; supply barycentric weights in bounded row batches."""
 w,h=resolution;p=np.asarray(uv,dtype=np.float64)*np.array([w,h]);a,b,c=p
 det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
 if abs(det)<1e-9:return
 x0=max(0,int(math.floor(p[:,0].min())));x1=min(w-1,int(math.ceil(p[:,0].max())));y0=max(0,int(math.floor(p[:,1].min())));y1=min(h-1,int(math.ceil(p[:,1].max())))
 if x0>x1 or y0>y1:return
 for row in range(y0,y1+1,128):
  xx,yy=np.meshgrid(np.arange(x0,x1+1)+.5,np.arange(row,min(row+128,y1+1))+.5)
  f=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/det;g=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/det;q=1-f-g;inside=(f>=-1e-6)&(g>=-1e-6)&(q>=-1e-6)
  if not inside.any():continue
  ys,xs=np.nonzero(inside);weights=np.stack((f[inside],g[inside],q[inside]),1);callback(xs+x0,ys+row,weights)

def triangles(ob):
 me=ob.data;me.calc_loop_triangles();xyz=np.empty(len(me.vertices)*3,np.float32);me.vertices.foreach_get('co',xyz);xyz=xyz.reshape(-1,3);m=np.asarray(ob.matrix_world);xyz=xyz@m[:3,:3].T+m[:3,3]
 if not me.uv_layers.active:return
 uv=np.empty(len(me.uv_layers.active.data)*2,np.float32);me.uv_layers.active.data.foreach_get('uv',uv);uv=uv.reshape(-1,2)
 for t in me.loop_triangles:yield xyz[list(t.vertices)],uv[list(t.loops)],me.materials[t.material_index]

def points(ob):
 a=np.empty(len(ob.data.vertices)*3,np.float32);ob.data.vertices.foreach_get('co',a);a=a.reshape(-1,3);m=np.asarray(ob.matrix_world);return a@m[:3,:3].T+m[:3,3]

def bounds(parts):
 a=np.concatenate([points(o) for o in parts if len(o.data.vertices)]);return a.min(0),a.max(0)

def frame(parts):
 lo,hi=bounds(parts);body=[o for o in parts if re.search(r'fuselage|^body',o.get('sourceName',''),re.I)]
 body=[max(body or parts,key=lambda o:np.ptp(points(o)[:,0]))]
 b0,b1=bounds(body)
 return {'nose':float(lo[0]),'length':float(hi[0]-lo[0]),'centerZ':float((b0[2]+b1[2])/2),'radius':float((b1[1]-b0[1])/2),'top':float(hi[2])}

def chart(p,f,kind):
 if kind=='body':return np.stack(((p[:,0]-f['nose'])/f['length'],(np.arctan2(p[:,2]-f['centerZ'],p[:,1])/(2*np.pi))%1),1)
 if kind=='fin':return np.stack((((p[:,0]-f['nose'])/f['length']-.65)/.35,(p[:,2]-f['centerZ'])/(f['top']-f['centerZ'])),1)
 return np.stack(((p[:,0]-f['x0'])/f['length'],(np.arctan2(p[:,2]-f['z'],p[:,1]-f['y'])/(2*np.pi))%1),1)

def image_array(image,max_size=4096):
 temp=None
 if max(image.size)>max_size:
  temp=image.copy();scale=max_size/max(image.size);temp.scale(round(image.size[0]*scale),round(image.size[1]*scale));image=temp
 a=np.empty(image.size[0]*image.size[1]*4,np.float32);image.pixels.foreach_get(a);a=a.reshape(image.size[1],image.size[0],4)
 if temp:bpy.data.images.remove(temp)
 return a

def sample(a,uv):
 h,w=a.shape[:2];x=(uv[:,0]%1)*w-.5;y=(uv[:,1]%1)*h-.5;x0=np.floor(x).astype(np.int32);y0=np.floor(y).astype(np.int32);fx=(x-x0)[:,None];fy=(y-y0)[:,None]
 return (a[y0%h,x0%w]*(1-fx)+a[y0%h,(x0+1)%w]*fx)*(1-fy)+(a[(y0+1)%h,x0%w]*(1-fx)+a[(y0+1)%h,(x0+1)%w]*fx)*fy

def fill_holes(color,coverage,iterations=24):
 # Fill only missing samples from the source skin; silhouettes outside fin
 # coverage remain outside the destination's own UV triangles.
 for _ in range(iterations):
  if coverage.all():break
  total=np.zeros_like(color);count=np.zeros_like(coverage,dtype=np.uint8)
  for dy,dx in [(1,0),(-1,0),(0,1),(0,-1)]:
   valid=np.roll(coverage,(dy,dx),(0,1));total+=np.roll(color,(dy,dx),(0,1))*valid[:,:,None];count+=valid
  take=(~coverage)&(count>0)
  if not take.any():break
  color[take]=total[take]/count[take,None];coverage[take]=True

class SurfaceAtlas:
 def __init__(self,width,height):
  self.rgb=np.ones((height,width,3),np.float32);self.mask=np.zeros((height,width,1),np.float32);self.coverage=np.zeros((height,width),bool);self.depth=np.full((height,width),-np.inf,np.float32)
 def add(self,coords,source_uv,material,read_color,window,periodic,depths):
  positions=np.asarray(coords).copy()
  if periodic and np.ptp(positions[:,1])>.5:positions[positions[:,1]<.5,1]+=1
  def draw(pos):
   def write(x,y,b):
    depth=b@depths+(5 if window else 0);visible=depth>=self.depth[y,x]-1e-5
    if visible.any():
     x=x[visible];y=y[visible];weights=b[visible];self.rgb[y,x]=read_color(material,weights@source_uv);self.mask[y,x]=float(window);self.coverage[y,x]=True;self.depth[y,x]=depth[visible]
   raster(pos,(self.rgb.shape[1],self.rgb.shape[0]),write)
  draw(positions)
  if periodic and positions[:,1].max()>1:positions[:,1]-=1;draw(positions)
 def finish(self):fill_holes(self.rgb,self.coverage.copy())

def apply_paint_projection(base,key,liv,objects,root):
 config=liv.get('paintProjection')
 if not config:
  finishes=apply_operator_finishes(base,key,liv,objects)
  return {'operatorFinishParts':finishes,'reviewStatus':'requires-visual-review'} if finishes else None
 with bpy.data.libraries.load(str(base/config['sourceBlend']),link=False) as (available,loaded):loaded.objects=list(available.objects)
 collection=bpy.data.collections.new('TemporaryPaintDonor');bpy.context.scene.collection.children.link(collection);donors=[o for o in loaded.objects if o]
 for ob in donors:collection.objects.link(ob)
 bpy.context.view_layer.update();source=[o for o in donors if o.type=='MESH'];sf=frame(source);tf=frame(objects);cache={}
 def read_color(mat,uv):
  shader=mat.node_tree.nodes.get('Principled BSDF') if mat and mat.use_nodes else None
  if shader and shader.inputs['Base Color'].is_linked:
   node=shader.inputs['Base Color'].links[0].from_node
   if node.type=='TEX_IMAGE':
    image=node.image;override=config.get('sourceTextureOverrides',{}).get(pathlib.Path(image.filepath).name)
    if override:image=bpy.data.images.load(str(base/override),check_existing=True)
    if image.name not in cache:cache[image.name]=image_array(image)
    return sample(cache[image.name],uv)[:,:3]
  linear=np.array(shader.inputs['Base Color'].default_value[:3] if shader else [1,1,1]);srgb=np.where(linear<=.0031308,linear*12.92,1.055*np.maximum(linear,0)**(1/2.4)-.055)
  return np.broadcast_to(srgb,(len(uv),3))
 body=SurfaceAtlas(config.get('bodyResolution',4096),config.get('angularResolution',1024));fins=[SurfaceAtlas(1536,1536),SurfaceAtlas(1536,1536)]
 source_counts={'body':0,'fin':0};body_pattern=re.compile(config.get('sourceBodyPattern',r'fuselage|belly|window|Door|door|Pane|^Cargo'),re.I)
 for ob in source:
  name=ob.get('sourceName','')
  if re.search(r'lighted|\.int$|interior|inside|^shadow|flare|spot',name,re.I):continue
  is_fin=bool(re.search(config.get('finPartPattern',r'^vstab|^v-stab|^fin$|^rudder'),name,re.I))
  if not is_fin and not body_pattern.search(name):continue
  for xyz,uv,mat in triangles(ob):
   window=bool(mat.get('cabinWindow') and not mat.get('cabinMask')) if mat else False
   if window and config.get('stripDonorWindows'):continue
   if is_fin:
    side=0 if xyz[:,1].mean()<0 else 1;fins[side].add(chart(xyz,sf,'fin'),uv,mat,read_color,window,False,np.abs(xyz[:,1]));source_counts['fin']+=1
   elif abs(xyz[:,1]).max()<sf['radius']*1.5:
    body.add(chart(xyz,sf,'body'),uv,mat,read_color,window,True,np.hypot(xyz[:,1],xyz[:,2]-sf['centerZ']));source_counts['body']+=1
 body.finish()
 for atlas in fins:atlas.finish()
 print('PAINT ATLAS',key,liv['id'],source_counts,flush=True)
 out=base/key/'generated'/liv['id'];out.mkdir(parents=True,exist_ok=True);results=[]
 # Body/fin transfer writes into the target's existing UV atlas. Unrelated
 # wing and fitting UV islands retain the neutral source pixels.
 target_materials={};target_parts=[];pattern=re.compile(config.get('bodyTexturePattern',r'737-9\.png$'),re.I);part_pattern=re.compile(config.get('bodyPartPattern',r'^(fuselage|belly|door\.[FA][LR]O|cdoor\.(fwd|aft)O|v-stab|rudder)$'),re.I)
 for ob in objects:
  if not part_pattern.search(ob.get('sourceName','')):continue
  indices=[]
  for i,mat in enumerate(ob.data.materials):
   if not mat or mat.get('cockpitGlazing') or (mat.get('cabinWindow') and not mat.get('cabinMask')):continue
   shader=mat.node_tree.nodes.get('Principled BSDF')
   if shader and shader.inputs['Base Color'].is_linked:
    node=shader.inputs['Base Color'].links[0].from_node
    if node.type=='TEX_IMAGE' and pattern.search(pathlib.Path(node.image.filepath).name):target_materials[mat]=node;indices.append(i)
  if indices:target_parts.append((ob,indices))
 if not target_parts:raise ValueError('No target skin matched the paint-transfer specification')
 groups={}
 for material,node in target_materials.items():groups.setdefault(node.image,[]).append(material)
 resolution=config.get('bodyResolution',4096)
 for atlas_index,(original_image,group_materials) in enumerate(groups.items()):
  temp=original_image.copy();temp.scale(resolution,resolution);color=image_array(temp,max_size=resolution)[:,:,:3].copy();bpy.data.images.remove(temp);mask=np.zeros((resolution,resolution,3),np.float32)
  for ob,indices in target_parts:
   name=ob.get('sourceName','');is_fin=bool(re.search(config.get('finPartPattern',r'^vstab|^v-stab|^fin$|^rudder'),name,re.I))
   for xyz,uv,mat in triangles(ob):
    if mat not in group_materials:continue
    def write(x,y,b,xyz=xyz,is_fin=is_fin,mat=mat,uv=uv):
     p=b@xyz
     if is_fin:
      c=chart(p,tf,'fin');side=p[:,1]<0;rgb=np.empty((len(p),3),np.float32)
      for index,selection in [(0,side),(1,~side)]:
       if selection.any():rgb[selection]=sample(fins[index].rgb,c[selection])
      color[y,x]=rgb
     else:
      c=chart(p,tf,'body');rgb=sample(body.rgb,c);mask[y,x]=sample(body.mask,c)
      if config.get('preserveTargetCabinMask') and mat.get('cabinMask'):
       maskpath=mat['cabinMask']
       if maskpath not in cache:cache[maskpath]=image_array(bpy.data.images.load(str(base/maskpath),check_existing=True))
       alpha=sample(cache[maskpath],b@uv)[:,:3].max(1)[:,None]
       rgb=rgb*(1-alpha)+np.array([.035,.065,.085])*alpha
      color[y,x]=rgb
    raster(uv,(resolution,resolution),write)
  suffix='' if len(groups)==1 else '-'+str(atlas_index)
  path=out/('body-color'+suffix+'.png');write_png(path,color);image=bpy.data.images.load(str(path),check_existing=False);image.pack()
  for material in group_materials:target_materials[material].image=image
  if config.get('bakeCabinMask',True):
   mask_path=out/('body-cabin-mask'+suffix+'.png');write_png(mask_path,mask);emission=bpy.data.images.load(str(mask_path),check_existing=False);emission.pack()
   for mat in group_materials:
    shader=mat.node_tree.nodes.get('Principled BSDF');node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=emission;mat.node_tree.links.new(node.outputs['Color'],shader.inputs['Emission Color']);shader.inputs['Emission Strength'].default_value=1;mat['cabinWindow']=True;mat['cabinMask']=str(mask_path.relative_to(base))
  results.append({'surface':'body-and-fin','resolution':resolution,'sourceAtlas':original_image.name,'map':str(path.relative_to(base)),'sourceTriangles':source_counts})
 finishes=apply_operator_finishes(base,key,liv,objects)
 for ob in donors:bpy.data.objects.remove(ob,do_unlink=True)
 bpy.data.collections.remove(collection);bpy.data.orphans_purge(do_recursive=True)
 return {'method':'Original cylindrical fuselage and planar fin surface-coordinate transfer; target geometry and UVs retained','sourceBlend':config['sourceBlend'],'maps':results,'operatorFinishParts':finishes,'enginePaintStatus':'operator-specific finish applied; visual review required' if finishes else 'original target map; operator finish pending','reviewStatus':'requires-visual-review'}

def apply_operator_finishes(base,key,liv,objects):
 config=liv.get('paintProjection',{})
 out=base/key/'generated'/liv['id'];out.mkdir(parents=True,exist_ok=True)
 finishes=[];finish_cache={};colored_maps={}
 # Keep projected operator paint (for example black ANZ nacelles) when a
 # livery also overrides unpainted fan/liner materials. Explicit finishes run
 # last so a deliberate per-livery override still wins.
 for index,finish in enumerate(config.get('finishes',[])+liv.get('operatorFinishes',[])):
  color_srgb=np.array(finish['colorSRGB'],dtype=np.float32)/255
  for ob in objects:
   if not re.search(finish['partPattern'],ob.get('sourceName',''),re.I):continue
   selected_faces=None
   if finish.get('surfaceRegion'):
    region=finish['surfaceRegion'];axis={'x':0,'y':1,'z':2}[region.get('axis','x')]
    start=min(v.co[axis] for v in ob.data.vertices) if region.get('fromFront') else 0
    low,high=region['range']
    selected_faces={p.index for p in ob.data.polygons
                    if low<=sum(ob.data.vertices[i].co[axis] for i in p.vertices)/len(p.vertices)-start<=high}
    if region.get('radialMaximum') is not None:
     transverse=[i for i in range(3) if i!=axis]
     center=[(min(v.co[i] for v in ob.data.vertices)+max(v.co[i] for v in ob.data.vertices))/2 for i in transverse]
     selected_faces={p.index for p in ob.data.polygons if p.index in selected_faces and
                     sum((sum(ob.data.vertices[v].co[i] for v in p.vertices)/len(p.vertices)-c)**2
                         for i,c in zip(transverse,center))<=region['radialMaximum']**2}
    if not selected_faces:continue
   for slot,original in enumerate(list(ob.data.materials)):
    if finish.get('materialPattern') and not re.search(finish['materialPattern'],original.name,re.I):continue
    cache_key=(original,index)
    if cache_key not in finish_cache:
     material=original.copy();material.name=original.name+' '+finish['name'];shader=material.node_tree.nodes.get('Principled BSDF');base_input=shader.inputs['Base Color']
     if finish.get('preserveColor'):pass
     elif not finish.get('flatColor') and base_input.is_linked and base_input.links[0].from_node.type=='TEX_IMAGE':
      node=base_input.links[0].from_node;image_key=(node.image.name,index)
      if image_key not in colored_maps:
       rgba=image_array(node.image,max_size=4096).copy();rgb=rgba[:,:,:3];brightness=rgb.mean(2);neutral=(rgb.max(2)-rgb.min(2)<.08)&(brightness>.5);coat=float(np.median(brightness[neutral])) if neutral.any() else 1
       rgba[:,:,:3]=np.clip(brightness[:,:,None]/max(coat,.5)*color_srgb,0,1);finish_path=out/(finish['name']+'-color.png');write_png(finish_path,rgba);colored=bpy.data.images.load(str(finish_path),check_existing=False);colored.pack();colored_maps[image_key]=colored
      node.image=colored_maps[image_key]
     else:
      for link in list(base_input.links):material.node_tree.links.remove(link)
      linear=np.where(color_srgb<=.04045,color_srgb/12.92,((color_srgb+.055)/1.055)**2.4);base_input.default_value=(*linear,1)
     for field,socket in [('metallic','Metallic'),('roughness','Roughness'),('coat','Coat Weight')]:
      if field in finish:
       for link in list(shader.inputs[socket].links):material.node_tree.links.remove(link)
       shader.inputs[socket].default_value=finish[field]
     material['operatorPaintFinish']=finish['name'];finish_cache[cache_key]=material
    if selected_faces is None:ob.data.materials[slot]=finish_cache[cache_key]
    else:
     target_slot=len(ob.data.materials);ob.data.materials.append(finish_cache[cache_key])
     for polygon in ob.data.polygons:
      if polygon.index in selected_faces and polygon.material_index==slot:polygon.material_index=target_slot
   finishes.append(ob['sourceName'])
 return finishes
