"""Measured barrel insertion, retaining native exterior sections and rig pivots."""
import bpy,re
from mathutils import Vector
from mathutils.bvhtree import BVHTree

def fit_registration_decals(base,objects,root,specs):
    added=[]
    for spec in specs:
        image=bpy.data.images.load(str(base/spec['image']),check_existing=True);image.pack()
        material=bpy.data.materials.new('Registration decal '+image.name);material.use_nodes=True
        shader=material.node_tree.nodes.get('Principled BSDF');shader.inputs['Roughness'].default_value=.30
        node=material.node_tree.nodes.new('ShaderNodeTexImage');node.image=image
        material.node_tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])
        material.node_tree.links.new(node.outputs['Alpha'],shader.inputs['Alpha'])
        material.surface_render_method='DITHERED'
        for target in list(objects):
            if not re.search(spec['partPattern'],target['sourceName']):continue
            for side in ((-1,1) if spec.get("bothSides") else (1 if sum(v.co.y for v in target.data.vertices)>0 else -1,)):
                bvh=BVHTree.FromPolygons([v.co for v in target.data.vertices],
                                        [tuple(p.vertices) for p in target.data.polygons])
                vertices=[];uv=[];missing=set()
                cx,cz=spec['center'];width,height=spec['size'];nx,nz=spec.get('grid',[25,7])
                alpha=list(image.pixels)[3::4] if spec.get('clipTransparentCorners') else None
                for ix in range(nx):
                    for iz in range(nz):
                        u,v=ix/(nx-1),iz/(nz-1)
                        start=Vector((cx+(u-.5)*width,side*40,cz+(v-.5)*height))
                        point,normal,_,_=bvh.ray_cast(start,Vector((0,-side,0)))
                        if point is None:
                            # A circular mark's transparent square corners may
                            # fall beyond a swept fin. Trim only transparent
                            # samples; opaque artwork must remain on the skin.
                            px=round(u*(image.size[0]-1));py=round(v*(image.size[1]-1))
                            if alpha is None or alpha[py*image.size[0]+px]>.01:
                                raise ValueError('Opaque decal extends outside surface: '+target.name)
                            missing.add(len(vertices));point=Vector((cx,0,cz))
                        vertices.append(point+Vector((0,side*.012,0)))
                        uv.append((1-u if side>0 else u,v))
                faces=[(i*nz+j,(i+1)*nz+j,(i+1)*nz+j+1,i*nz+j+1)
                       for i in range(nx-1) for j in range(nz-1)]
                faces=[f for f in faces if not missing.intersection(f)]
                if side>0:faces=[tuple(reversed(f)) for f in faces]
                name='Fitted decal '+target['sourcePartId']+' '+str(side)
                data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.materials.append(material)
                layer=data.uv_layers.new()
                for face in data.polygons:
                    face.use_smooth=True
                    for loop in face.loop_indices:layer.data[loop].uv=uv[data.loops[loop].vertex_index]
                data.update();ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob);ob.parent=root
                ob['sourceName']=name;ob['sourcePartId']=name;ob['sourceModel']='Original registration decal fitted to GPL nacelle'
                objects.append(ob);added.append(name)
    return added

def insert_barrels(objects,motions,fixtures,root,plugs):
    additions=[]
    for number,plug in enumerate(plugs):
        station,length=plug['station'],plug['length']
        low,high=plug['windowTemplate']
        center=(low+high)/2
        target=station-length/2
        copies=[]
        for cabin in objects:
            if not any(m and m.get('cabinWindow') for m in cabin.data.materials):continue
            polygons=[p for p in cabin.data.polygons
                      if all(low<=cabin.data.vertices[i].co.x<=high for i in p.vertices)]
            if not polygons:continue
            ids=sorted({i for p in polygons for i in p.vertices});indices={v:i for i,v in enumerate(ids)}
            vertices=[cabin.data.vertices[i].co.copy() for i in ids]
            for v in vertices:v.x+=target-center
            name=f'Global 6000 added barrel pane {number+1} {len(copies)+1}'
            data=bpy.data.meshes.new(name)
            data.from_pydata(vertices,[],[tuple(indices[i] for i in p.vertices) for p in polygons])
            for material in cabin.data.materials:data.materials.append(material)
            data.update()
            for face,source in zip(data.polygons,polygons):face.material_index=source.material_index;face.use_smooth=True
            ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob);ob.parent=root
            ob['sourceName']=name;ob['sourcePartId']=name;ob['sourceModel']='Authored Global 6000 barrel glazing fitted to GPL source'
            copies.append(ob);additions.append(name)
        assert len(copies)==2,'Barrel extension requires a pane on both cabin sides'
        for ob in objects:
            for v in ob.data.vertices:
                if v.co.x<=station:v.co.x-=length
            ob.data.update()
        for motion in motions:
            if motion['center'][0]<=station:motion['center'][0]-=length
        for light in fixtures:
            if light['position'][0]<=station:light['position'][0]-=length
        objects.extend(copies)
    return {'fuselageInsertions':plugs,'addedCabinPanes':additions,
            'method':'Insert a parallel cabin barrel between native panes; retain nose/tail sections, wing, gear, engine parts, and map each native mechanism pivot with its assembly.'}
