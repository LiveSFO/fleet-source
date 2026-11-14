"""Render saved Blender aircraft in repeatable views for exterior review.

Run in Blender background mode, with aircraft/livery selectors after --.
A third component selects profile, front, plan, mechanisms or cabin.
"""
import json
import math
import os
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

BASE = Path(__file__).resolve().parents[1] / 'assets' / 'airliners'
ANGLES = {'overview': (-.46, -1, .30), 'profile': (0, -1, .095),
          'starboard': (-.46, 1, .30), 'rear': (1, -.32, .15),
          'front': (-1, -.003, .055), 'plan': (-.001, -.001, 1),
          'mechanisms': (.43, -1, .06), 'cabin': (0, -1, .08),
          'stowed': (-.32, -1, -.12)}


def blender_axes(point):
    return Vector((point[0], -point[2], point[1]))


def pose(objects, rig, state):
    if any('targetPartIds' not in motion for motion in rig['motions']):
        # The original nine releases bind by source model/name. Normalize only
        # this legacy schema; the newer ID-keyed posing path stays unchanged.
        for obj in objects:
            if not obj.get('sourcePartId'):obj['sourcePartId']='review:'+obj.name
        rig={**rig,'motions':[{**motion,'targetPartIds':[
            obj['sourcePartId'] for obj in objects
            if obj.get('sourceModel')==motion['model'] and obj.get('sourceName') in motion['targets']
        ]} for motion in rig['motions']],
             'gearInternalPartIds':[obj['sourcePartId'] for obj in objects
                                    if obj.get('sourceName') in rig.get('gearInternalParts',[])]}
    parts = {obj.get('sourcePartId'): obj for obj in objects if obj.get('sourcePartId')}
    transforms = {name: Matrix.Identity(4) for name in parts}
    for motion in rig['motions']:
        control = motion['control']
        if control not in state or motion['type']=='spin':
            continue
        value = state[control] * motion.get('inputScale', 1)
        if control=='gear' and 'hydraulic/gear/door-' in motion['property']:
            value = abs(math.sin(math.pi*value))**.65
        if motion['interpolation']:
            knots = motion['interpolation']
            if value <= knots[0][0]:
                value = knots[0][1]
            elif value >= knots[-1][0]:
                value = knots[-1][1]
            else:
                for (a,b),(c,d) in zip(knots,knots[1:]):
                    if a <= value <= c:
                        value = b+(d-b)*(value-a)/(c-a)
                        break
        value = value*motion['factor']+motion['offset']
        if motion['min'] is not None:
            value = max(float(motion['min']),value)
        if motion['max'] is not None:
            value = min(float(motion['max']),value)
        axis = blender_axes(motion['axis']).normalized()
        if not axis.length_squared:
            continue
        center = blender_axes(motion['center'])
        if motion['type']=='translate':
            transform = Matrix.Translation(axis*value)
        else:
            transform = (Matrix.Translation(center) @ Matrix.Rotation(math.radians(value),4,axis)
                         @ Matrix.Translation(-center))
        for name in motion['targetPartIds']:
            if name in transforms:
                transforms[name] @= transform
    for name, obj in parts.items():
        obj.matrix_world = transforms[name] @ obj.matrix_world
        if not state.get('gear',1) and name in rig['gearInternalPartIds']:
            obj.hide_render = True


def area(scene, name, where, center, power, size, color):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size, data.color = power,'DISK',size,color
    obj = bpy.data.objects.new(name,data)
    scene.collection.objects.link(obj)
    obj.location = where
    obj.rotation_euler = (center-obj.location).to_track_quat('-Z','Y').to_euler()


def render(selector, output, width):
    key,paint,*modes = selector.split('/')
    mode = modes[0] if modes else 'overview'
    if mode not in ANGLES:
        raise ValueError('Unknown review view '+mode)
    folder = BASE/key
    bpy.ops.wm.open_mainfile(filepath=str(folder/(paint+'.blend')))
    scene = bpy.context.scene
    aircraft = [obj for obj in scene.objects if obj.type=='MESH' and obj.parent]
    # The converter stores an emission mask at strength 1 for runtime switching.
    # A daylight review must explicitly turn it off, as the public loader does.
    for material in {m for obj in aircraft for m in obj.data.materials if m}:
        if material.get('cabinWindow'):
            material.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=0
    pts = [obj.matrix_world @ Vector(v) for obj in aircraft for v in obj.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    length, span, height = hi-lo
    size = max(length,span)
    focus = Vector(((hi.x+lo.x)/2,0,lo.z+height*.49))
    ground = lo.z-.03
    if mode in ('mechanisms','cabin','stowed'):
        rig=json.loads((folder/'exports'/(paint+'.rig.json')).read_text())
        if mode=='mechanisms':
            pose(aircraft,rig,{'gear':1,'flaps':1,'slats':1,'reversers':1,'spoilers':1})
        else:
            pose(aircraft,rig,{'gear':0,'flaps':0,'slats':0,'reversers':0,'spoilers':0})
            if mode=='cabin':
                for material in {m for obj in aircraft for m in obj.data.materials if m}:
                    if material.get('cabinWindow'):
                        shader=material.node_tree.nodes.get('Principled BSDF')
                        shader.inputs['Emission Strength'].default_value=2.3
            ground-=height*2
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 12 if width>=1000 else 6
    scene.cycles.use_denoising = True
    scene.render.resolution_x = width
    scene.render.resolution_y = int(width*.55)
    scene.render.resolution_percentage = 100
    scene.world = bpy.data.worlds.new('Studio environment')
    scene.world.use_nodes = True
    background=scene.world.node_tree.nodes.get('Background')
    background.inputs[0].default_value=(.21,.25,.33,1)
    background.inputs[1].default_value=.1 if mode=='cabin' else .47
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.exposure = -.25
    bpy.ops.mesh.primitive_plane_add(size=size*140,location=(focus.x,0,ground))
    pavement = bpy.data.materials.new('Neutral pavement')
    pavement.use_nodes = True
    shader=pavement.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value=(.105,.12,.145,1)
    shader.inputs['Roughness'].default_value=.89
    bpy.context.object.data.materials.append(pavement)
    area(scene,'Key',focus+size*Vector((-.48,-.7,1.03)),focus,size*size*(12 if mode=='cabin' else 48),
         size*.42,(1,.93,.84))
    area(scene,'Fill',focus+size*Vector((.15,.69,.67)),focus,size*size*25,
         size*.67,(.78,.87,1))
    area(scene,'Tail rim',focus+size*Vector((.7,-.1,.55)),focus,size*size*17,
         size*.54,(.89,.94,1))
    data = bpy.data.cameras.new('Review camera')
    data.type = 'ORTHO'
    data.ortho_scale = (span if mode=='front' else size)*1.105
    if mode=='plan':
        data.ortho_scale=max(length*1.10,span*1.10/.55)
    camera=bpy.data.objects.new('Review camera',data)
    scene.collection.objects.link(camera)
    camera.location=focus+size*1.8*Vector(ANGLES[mode]).normalized()
    camera.rotation_euler=(focus-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.clip_end=size*180
    scene.camera=camera
    scene.render.filepath=str(output/f'{key}-{paint}-{mode}.png')
    bpy.ops.render.render(write_still=True)


if __name__=='__main__':
    selectors=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    output=Path(os.environ.get('FLEET_REVIEW_OUTPUT',BASE/'previews'))
    output.mkdir(exist_ok=True,parents=True)
    for selector in selectors:
        render(selector,output,int(os.environ.get('FLEET_REVIEW_WIDTH','1260')))
