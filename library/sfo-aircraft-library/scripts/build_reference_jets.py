"""Build original, measured airframes with movable exterior components.

Profile coordinates use meters from the nose, with starboard positive and the
static ground plane at z=0. The glTF exporter changes these to X aft, Y up,
Z port. Manufacturer drawings are dimensional references, never textures.
"""
import json
import math
from bisect import bisect_right

import bpy
import numpy as np
from mathutils import Vector


def gltf(point):
    x, y, z = point
    return [x, z, -y]


def stations(rows, value):
    """Interpolate station values with monotone cubic tangents."""
    i = min(len(rows) - 2, max(0, bisect_right([r[0] for r in rows], value) - 1))
    left, right = rows[i:i+2]
    width = right[0] - left[0]
    t = max(0, min(1, (value - left[0]) / width))
    result = []
    for col in range(1, len(left)):
        delta = (right[col] - left[col]) / width
        slopes = []
        for at in (i, i + 1):
            if at == 0 or at == len(rows) - 1:
                slopes.append(delta)
                continue
            lo, mid, hi = rows[at-1:at+2]
            first = (mid[col] - lo[col]) / (mid[0] - lo[0])
            second = (hi[col] - mid[col]) / (hi[0] - mid[0])
            slopes.append(2 * first * second / (first + second) if first * second > 0 else 0)
        a, b = slopes
        result.append((2*t**3-3*t*t+1)*left[col] + (t**3-2*t*t+t)*width*a
                      + (-2*t**3+3*t*t)*right[col] + (t**3-t*t)*width*b)
    return result


def line(start, end, step):
    return np.linspace(start, end, max(2, 1 + math.ceil((end - start) / step)))


def linear_rgb(hex_color):
    rgb = [int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return [v / 12.92 if v < .04045 else ((v + .055) / 1.055)**2.4 for v in rgb]


def png_image(name, pixels):
    height, width, _ = pixels.shape
    image = bpy.data.images.new(name, width, height, alpha=True)
    image.pixels.foreach_set(np.asarray(pixels, dtype=np.float32).ravel())
    image.pack()
    return image


def alpha_map(path):
    image = bpy.data.images.load(str(path), check_existing=True)
    rgba = np.asarray(image.pixels[:], dtype=np.float32).reshape(image.size[1],image.size[0],4)
    alpha = rgba[:,:,3]
    y,x = np.nonzero(alpha>.1)
    return alpha[y.min():y.max()+1,x.min():x.max()+1]


def stamp(pixels, mask, u, v, box, color):
    xa,xb,ya,yb = box
    selected = (u>=xa)&(u<=xb)&(v>=ya)&(v<=yb)
    row = ((v[selected]-ya)/(yb-ya)*(mask.shape[0]-1)).astype(int)
    col = ((u[selected]-xa)/(xb-xa)*(mask.shape[1]-1)).astype(int)
    alpha = mask[row,col][:,None]
    pixels[selected,:3] = pixels[selected,:3]*(1-alpha)+np.asarray(linear_rgb(color))*alpha


def swatch(name, hex_color, metallic=0, rough=.33, coat=0, texture=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*linear_rgb(hex_color), 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = rough
    shader.inputs['Coat Weight'].default_value = coat
    shader.inputs['Coat Roughness'].default_value = .18
    if texture:
        sample = mat.node_tree.nodes.new('ShaderNodeTexImage')
        sample.image = texture
        mat.node_tree.links.new(sample.outputs['Color'], shader.inputs['Base Color'])
    return mat


def roundrect(cx, cz, w, h, radius, detail=8):
    points = []
    for corner, (ox, oz) in enumerate(((w/2-radius, h/2-radius), (-w/2+radius, h/2-radius),
                                      (-w/2+radius, -h/2+radius), (w/2-radius, -h/2+radius))):
        for t in np.linspace(corner*math.pi/2, (corner+1)*math.pi/2, detail):
            points.append((cx+ox+radius*math.cos(t), cz+oz+radius*math.sin(t)))
    return points


def paint_pixels(profile, spec, logo_path):
    """Use the same axial and circumferential UV as the pressure shell."""
    length = profile[-1][0]
    width, height = 4096, 512
    x = (np.arange(width)+.5)*length/width
    angle = (np.arange(height)+.5)*math.tau/height
    center, _, radius = np.array([stations(profile, v) for v in x]).T
    z = center[None, :] + np.sin(angle[:, None])*radius[None, :]
    pixels = np.empty((height, width, 4), dtype=np.float32)
    pixels[:, :, :3] = linear_rgb(spec['base'])
    pixels[:, :, 3] = 1
    for band in spec.get('bands', []):
        start, end, color = band
        low = np.interp(x, [v[0] for v in start], [v[1] for v in start]) if start else -100
        high = np.interp(x, [v[0] for v in end], [v[1] for v in end])
        pixels[(z >= low) & (z < high), :3] = linear_rgb(color)
    if logo_path:
        mask = alpha_map(logo_path)
        xa, xb, za, zb, color = spec['logo']
        for direction in (1, -1):
            surface = (np.cos(angle[:, None])*direction >= 0) & (x >= xa) & (x <= xb) & (z >= za) & (z <= zb)
            row, col = np.nonzero(surface)
            u = (x[col]-xa)/(xb-xa)
            if direction > 0:
                u = 1 - u
            v = (z[row,col]-za)/(zb-za)
            alpha = mask[np.clip((v*mask.shape[0]).astype(int),0,mask.shape[0]-1),
                         np.clip((u*mask.shape[1]).astype(int),0,mask.shape[1]-1)][:, None]
            pixels[row,col,:3] = pixels[row,col,:3]*(1-alpha) + np.array(linear_rgb(color))*alpha
    return pixels


class Jet:
    def __init__(self, base, key, config, livery):
        self.base, self.key, self.config, self.livery = base, key, config, livery
        self.profile = config['profile']
        self.length = self.profile[-1][0]
        self.span = config['dimensions']['span']
        self.folder = base/key
        self.output = self.folder/'exports'
        self.output.mkdir(parents=True, exist_ok=True)
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        self.root = bpy.data.objects.new('Aircraft', None)
        bpy.context.collection.objects.link(self.root)
        self.root['aircraft'] = config['label']
        self.root['livery'] = livery['name']
        self.root['units'] = 'meters'
        self.objects, self.motions, self.gear_parts, self.lights = [], [], [], []
        paint = livery['paint']
        logo = base/'preparation'/'brand-art'/paint['logoFile'] if 'logoFile' in paint else None
        self.body = swatch('Fuselage paint', paint['base'], .05, .25, .48,
                           png_image('Fuselage paint and markings', paint_pixels(self.profile, paint, logo)))
        self.white = swatch('Gloss painted composite', paint['base'], .06, .24, .47)
        self.wing = swatch('Wing skin', paint.get('wing','c9cdd3'), .22, .31, .32)
        self.edge = swatch('Polished leading edge', 'b7bcc3', .79, .22)
        self.steel = swatch('Machined and painted steel', 'a0a8b0', .62, .31)
        self.chrome = swatch('Oleo chrome', 'dde3ea', .91, .16)
        self.bay = swatch('Gear well shadows and seals', '282e33', .1, .51)
        self.duct = swatch('Intake acoustic liner', '41484e', .32, .49)
        self.hot = swatch('Heat-stained exhaust alloy', '514e4e', .79, .37)
        self.blade = swatch('Fan blades', '737b83', .71, .32)
        self.trim = swatch('Window trim', paint.get('trim','596169'), .36, .32)
        self.seal = swatch('Door perimeter', '757c82', .17, .45)
        self.glass = swatch('Smoked flight deck glazing', '111c27', .12, .28, .12)
        self.glass['cockpitGlazing'] = True
        self.cabin = swatch('Smoked passenger glazing', '15202b', .12, .24, .18)
        self.cabin['cabinWindow'] = True
        self.cabin.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value = (1,.68,.34,1)
        # Two additional maps capture circumferential rubber grain and axial
        # variations in the nacelle liner, independent of the livery atlas.
        rng = np.random.default_rng(303)
        grain = .016 + rng.random((48,128))*.0045
        tread = np.repeat(grain[:,:,None], 4, axis=2)
        tread[:,:,3] = 1
        self.rubber = swatch('Aircraft tire rubber', '26272a', 0, .79,
                             texture=png_image('Tire rubber surface', tread))
        u, v = np.meshgrid(np.linspace(0,1,256), np.linspace(0,1,64))
        acoustic = .049 + .015*(1-u) + .004*np.cos(v*math.tau*16)
        liner = np.repeat(acoustic[:,:,None], 4, axis=2)
        liner[:,:,3] = 1
        self.liner = swatch('Nacelle acoustic panels', '40464c', .37, .48,
                            texture=png_image('Intake liner', liner))
        self.fin = self.fin_material(paint, logo)
        self.tip = swatch('Winglet paint', paint.get('winglet', paint['base']), .07, .27, .34)
        self.nacelle = self.white
        if 'engineMark' in paint:
            mark = paint['engineMark']
            pixels = np.ones((256,768,4), dtype=np.float32)
            pixels[:,:,:3] = linear_rgb(paint['base'])
            u,v = np.meshgrid((np.arange(768)+.5)/768,(np.arange(256)+.5)/256)
            v = (v+.25)% .5
            mark_u = np.where(np.cos(((np.arange(256)+.5)/256)[:,None]*math.tau)>0,1-u,u)
            stamp(pixels,alpha_map(self.brand_art(mark['file'])),mark_u,v,
                  (.30,.70,.21,.29),mark['color'])
            self.nacelle = swatch('Nacelle paint and registration',paint['base'],.06,.24,.47,
                                  png_image('Nacelle registration',pixels))

    def brand_art(self,filename):
        return self.base/'preparation'/'brand-art'/filename

    def fin_material(self, paint, logo):
        if not any(key in paint for key in ('porterFin','finBands','finMark')):
            return swatch('Tail paint', paint.get('fin', paint['base']), .06, .25, .4)
        width, height = 1536, 512
        pixels = np.ones((height, width, 4), dtype=np.float32)
        pixels[:, :, :3] = linear_rgb(paint.get('fin', paint['base']))
        u, v = np.meshgrid((np.arange(width)+.5)/width, (np.arange(height)+.5)/height)
        plane_u = (2*u)%1
        text_u = np.where(u<.5,plane_u,1-plane_u)
        for color, low, high, rise in paint.get('finBands', []):
            pixels[(v-rise*plane_u >= low)&(v-rise*plane_u < high), :3] = linear_rgb(color)
        if 'finMark' in paint:
            mark = paint['finMark']
            stamp(pixels,alpha_map(self.brand_art(mark['file'])),text_u,v,mark['box'],mark['color'])
        if paint.get('porterFin'):
            a = alpha_map(logo)
            for j in range(-2,9):
                for i in range(-1,4):
                    h = v-plane_u*.27-j*.139
                    x = text_u-i*.47-(j%2)*.23
                    mask = (h>=0)&(h<.104)&(x>=0)&(x<.436)
                    alpha = a[(h[mask]/.104*(a.shape[0]-1)).astype(int),
                              (x[mask]/.436*(a.shape[1]-1)).astype(int)][:,None]
                    color = np.array(linear_rgb(('90c9df','ffffff','4d94b2','badbea')[j%4]))
                    pixels[mask,:3] = pixels[mask,:3]*(1-alpha)+color*alpha
        return swatch('Tail paint and markings', 'ffffff', .05, .25, .4,
                      png_image('Tail markings', pixels))

    def mesh(self, name, verts, faces, material, uv=None, reverse=False, **extras):
        data = bpy.data.meshes.new(name)
        data.from_pydata(verts, [], [tuple(reversed(face)) if reverse else face for face in faces])
        data.materials.append(material)
        if uv is not None:
            layer = data.uv_layers.new()
            for face in data.polygons:
                for li in face.loop_indices:
                    layer.data[li].uv = uv[data.loops[li].vertex_index]
        for face in data.polygons:
            face.use_smooth = True
        data.update()
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.parent = self.root
        obj['sourcePartId'] = name
        obj['sourceName'] = name
        obj['sourceModel'] = self.key+'-reference-loft'
        for key, value in extras.items():
            obj[key] = value
        self.objects.append(obj)
        return obj

    def motion(self, control, kind, parts, axis, center, factor=1, offset=0, curve=(), spin=1):
        names = [o['sourcePartId'] for o in parts]
        self.motions.append(dict(control=control, type=kind, property='reference/'+control,
                                 factor=factor, offset=offset, axis=gltf(axis), center=gltf(center),
                                 interpolation=list(curve), min=None, max=None, spinDirection=spin,
                                 targets=names, targetPartIds=names, model=self.key+'-reference-loft'))

    def revolved(self, name, rings, material, center=(0,0,0), axis='X', count=64,
                 angles=(0,math.tau), paint_uv=False):
        """Rings are axial location, two radial extents, and section height."""
        vertices, uv = [], []
        n = count + 1
        for i,(x, ry, rz, height) in enumerate(rings):
            for j,t in enumerate(np.linspace(*angles,n)):
                y = ry*math.cos(t)
                z = height + rz*math.sin(t)
                point = (x,y,z) if axis=='X' else (-y,x,z)
                vertices.append(tuple(a+b for a,b in zip(center, point)))
                uv.append((x/self.length,j/count) if paint_uv else (i/(len(rings)-1),j/count))
        faces = [(i*n+j,i*n+j+1,(i+1)*n+j+1,(i+1)*n+j)
                 for i in range(len(rings)-1) for j in range(count)]
        return self.mesh(name, vertices, faces, material, uv)

    def fuselage(self):
        xs = line(0, self.length, .15)
        rings = [(x, ry, rz, center) for x in xs for center,ry,rz in [stations(self.profile,x)]]
        self.revolved('Fuselage pressure shell', rings, self.body, count=112, paint_uv=True)
        if 'fairing' in self.config:
            rows = self.config['fairing']
            self.revolved('Wing-to-body fairing',
                          [(x,ry,rz,z) for x in line(rows[0][0],rows[-1][0],.16)
                           for z,ry,rz in [stations(rows,x)]], self.white, count=64)

    def side(self, x, z, sign, stand=.008):
        cz, ry, rz = stations(self.profile, x)
        slope = max(-.994,min(.994,(z-cz)/rz))
        width = math.sqrt(1-slope*slope)
        return (x,sign*(ry+stand)*width,cz+(rz+stand)*slope)

    def pane(self, name, outline, sign, material, stand=.011, **extras):
        """Conform the whole pane to the shell, including its interior."""
        cx, cz = np.mean(outline, axis=0)
        points = [(cx,cz)]
        # Limit triangles on long, curved cockpit panes. Subdivide each edge.
        edge = []
        step = .033 if material == self.glass else .12
        for a,b in zip(outline,outline[1:]+outline[:1]):
            for f in np.linspace(0,1,max(2,math.ceil(math.dist(a,b)/step)+1))[:-1]:
                edge.append((a[0]+f*(b[0]-a[0]),a[1]+f*(b[1]-a[1])))
        n = len(edge)
        count = max(3,math.ceil(max(math.dist((cx,cz),q) for q in edge)/step))
        for w in np.linspace(1/count,1,count):
            points.extend((cx+w*(x-cx),cz+w*(z-cz)) for x,z in edge)
        faces = [(0,1+i,1+(i+1)%n) for i in range(n)]
        faces.extend((1+k*n+i,1+(k+1)*n+i,1+(k+1)*n+(i+1)%n,1+k*n+(i+1)%n)
                     for k in range(count-1) for i in range(n))
        return self.mesh(name,[self.side(x,z,sign,stand) for x,z in points],faces,material,
                         reverse=sign>0, **extras)

    def outline(self, name, outline, sign, material, width):
        center = np.mean(outline, axis=0)
        inner = []
        for x,z in outline:
            dx, dz = x-center[0], z-center[1]
            dist = math.hypot(dx,dz)
            inner.append((x-width*dx/dist,z-width*dz/dist))
        points = [self.side(x,z,sign,.014) for x,z in outline+inner]
        n = len(outline)
        return self.mesh(name,points,[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],
                         material,reverse=sign>0)

    def glazing(self):
        spec = self.config
        start, count, pitch, z, w, h = spec['windows']
        for sign,label in ((-1,'Port'),(1,'Starboard')):
            for i, corners in enumerate(spec['cockpit']):
                self.pane(f'{label} windshield {i+1}', [tuple(v) for v in corners], sign, self.glass, .026)
            doors = spec['doors'][0 if sign<0 else 1]
            for i in range(int(count)):
                x = start + pitch*i
                if any(abs(x-dx)<dw*.62 for dx,_,dw,_ in doors):
                    continue
                def window_shape(width,height):
                    if spec.get('ovalWindows'):
                        return [(x+width*.5*math.cos(t),z+height*.5*math.sin(t))
                                for t in np.linspace(0,math.tau,36,endpoint=False)]
                    return roundrect(x,z,width,height,min(w,h)*.43)
                shape = window_shape(w+.038,h+.038)
                self.pane(f'{label} passenger window seal {i+1}',shape,sign,self.trim)
                self.pane(f'{label} passenger window {i+1}',window_shape(w,h),
                          sign,self.cabin,.025)
            for i,(x,cz,width,height) in enumerate(doors):
                self.outline(f'{label} door {i+1} perimeter',roundrect(x,cz,width,height,min(width,height)*.15),
                             sign,self.seal,.022 if self.key=='e295' else .016)
                window = roundrect(x,z,min(w*.7,width*.55),h*.77,min(w,h)*.32)
                self.pane(f'{label} door window {i+1}',window,sign,self.cabin,.024,cabinDoorWindow=True)
                handle = roundrect(x+.2*width,cz-height*.13,width*.24,height*.036,height*.014)
                self.pane(f'{label} door handle {i+1}',handle,sign,self.steel,.026)

    @staticmethod
    def wing_point(rows, span, chord, sign, skin=0):
        leading,trailing,z,t = stations(rows,span)
        camber = (trailing-leading)*.019*math.sin(math.pi*chord)
        thickness = t*math.sin(math.pi*chord)**.66
        return (leading+(trailing-leading)*chord,sign*span,z+camber+skin*thickness)

    def wing_panel(self,name,rows,a,b,front,back,sign,material):
        spans = line(a,b,.26)
        chords = line(front,back,.042)
        verts, uv = [], []
        for skin in (1,-1):
            for s in spans:
                for c in chords:
                    verts.append(self.wing_point(rows,s,c,sign,skin))
                    uv.append((c,s/rows[-1][0]))
        n,m = len(chords),len(spans)
        layer = n*m
        faces = []
        for s in range(m-1):
            for c in range(n-1):
                q=s*n+c
                face=(q,q+1,q+1+n,q+n)
                faces += [face, tuple(i+layer for i in reversed(face))]
        for s in range(m-1):
            q=s*n
            faces += [(q,q+n,q+n+layer,q+layer),
                      (q+n-1,q+n-1+layer,q+2*n-1+layer,q+2*n-1)]
        for c in range(n-1):
            q=(m-1)*n+c
            faces += [(c,c+layer,c+1+layer,c+1),(q,q+1,q+1+layer,q+layer)]
        return self.mesh(name,verts,faces,material,uv,reverse=sign<0)

    def foil_tip(self, name, rows, root, sign, material):
        # Winglet sections lean outward as they rise, and taper independently.
        verts, uv = [], []
        n = 40
        for s,le,te,z,t in rows:
            for j,angle in enumerate(np.linspace(0,math.tau,n+1)):
                u = .5-.5*math.cos(angle)
                verts.append((le+(te-le)*u,sign*(s + t*math.sin(angle)*.75),z+t*.66*math.sin(angle)))
                uv.append((u,(s-root)/max(.2,rows[-1][0]-root)))
        faces=[(i*(n+1)+j,i*(n+1)+j+1,(i+1)*(n+1)+j+1,(i+1)*(n+1)+j)
               for i in range(len(rows)-1) for j in range(n)]
        return self.mesh(name,verts,faces,material,uv,reverse=sign>0)

    def wings(self):
        rows = self.config['wing']
        tip = rows[-1][0]
        for sign,side in ((-1,'Port'),(1,'Starboard')):
            sections = self.config['flaps']
            flap_start, flap_end = sections[0][0], sections[-1][1]
            front, back = (.72,.998)
            self.wing_panel(side+' wing main skin',rows,rows[0][0],tip,0,front,sign,self.wing)
            self.wing_panel(side+' root trailing edge',rows,rows[0][0],flap_start,front,back,sign,self.wing)
            for i,(a,b) in enumerate(sections):
                flap=self.wing_panel(f'{side} flap {i+1}',rows,a+.012,b-.012,front+.004,back,sign,self.wing)
                p=self.wing_point(rows,a,front,sign)
                q=self.wing_point(rows,b,front,sign)
                self.motion('flaps','rotate',[flap],(Vector(q)-Vector(p))*sign,p,38)
                if self.key=='e295':
                    self.motion('flaps','translate',[flap],(1,0,-.18),p,.24)
            self.wing_panel(side+' aileron and outer trailing edge',rows,flap_end,tip,front+.004,back,sign,self.wing)
            leading=self.wing_panel(side+' leading edge',rows,rows[0][0]+.05,tip-.01,.005,.054,sign,self.edge)
            # Offset the leading strip by millimeters to avoid duplicate coplanar skin.
            for vert in leading.data.vertices:
                vert.co.x-=.012
            for i,(a,b) in enumerate(self.config['spoilers']):
                chord=.55
                spoiler=self.wing_panel(f'{side} spoiler {i+1}',rows,a,b,chord,.708,sign,self.wing)
                for v in spoiler.data.vertices:
                    v.co.z+=.027 if self.key=='e295' else .015
                p=self.wing_point(rows,a,chord,sign,1)
                q=self.wing_point(rows,b,chord,sign,1)
                self.motion('spoilers','rotate',[spoiler],(Vector(q)-Vector(p))*sign,p,-51)
            for i,(a,b) in enumerate(sections):
                p=self.wing_point(rows,(a+b)/2,.82,sign,-1)
                x,y,z=p
                size=.82 if self.key=='e295' else .38
                self.revolved(f'{side} flap track fairing {i+1}',
                              [(x+size*t,size*r,size*r*.9,z-size*.08) for t,r in
                               ((-1,.014),(-.7,.13),(0,.15),(.8,.076),(1.12,.012))],
                              self.wing,center=(0,y,0),count=28)
            if self.config.get('tip'):
                self.foil_tip(side+' winglet',self.config['tip'],tip,sign,self.tip)
            nav = self.config.get('tip',rows)[-1]
            y,le,te,z,_ = nav
            p=(le+(te-le)*.31,sign*y,z+.013)
            self.light(side+' wing navigation','nav',p,'red' if sign<0 else 'green',False)
            self.light(side+' wing strobe','strobe',(p[0]+.12,p[1],p[2]),'white',False)
            p=self.wing_point(rows,rows[0][0]+.47,.074,sign,-1)
            self.light(side+' wing root landing light','landing',(p[0]-.045,p[1],p[2]-.015),'white')

    def tail(self):
        rows = self.config['fin']
        verts, uv = [], []
        heights=line(rows[0][0],rows[-1][0],.13)
        n=72
        minx=min(r[1] for r in rows)
        width=max(r[2] for r in rows)-minx
        for z in heights:
            lead,trail,t=stations(rows,z)
            for theta in np.linspace(0,math.tau,n+1):
                chord=.5-.5*math.cos(theta)
                x=lead+(trail-lead)*chord
                y=t*math.sin(theta)
                verts.append((x,y,z))
                u=(x-minx)/width
                uv.append((u*.498+(.501 if theta<=math.pi else 0),
                           (z-rows[0][0])/(rows[-1][0]-rows[0][0])))
        faces=[(i*(n+1)+j,(i+1)*(n+1)+j,(i+1)*(n+1)+j+1,i*(n+1)+j+1)
               for i in range(len(heights)-1) for j in range(n)]
        self.mesh('Vertical stabilizer and rudder',verts,faces,self.fin,uv)
        for sign,label in ((-1,'Port'),(1,'Starboard')):
            h=self.config['tail']
            self.wing_panel(label+' horizontal stabilizer',h,h[0][0],h[-1][0],0,.995,sign,self.wing)
        self.light('Tail position light','nav',(self.length-.015,0,self.profile[-1][1]),'white',False)
        self.light('Tail strobe','strobe',(self.length-.10,0,self.profile[-1][1]-.055),'white',False)
        x=self.length*.43
        cz,_,rz=stations(self.profile,x)
        self.light('Upper fuselage beacon','beacon',(x,0,cz+rz+.046),'red')
        self.light('Belly beacon','beacon',(x,0,cz-rz-.23),'red')

    def light(self, name, kind, point, color='white', housing=True):
        self.lights.append(dict(name=name,kind=kind,color=color,position=gltf(point),
                                basis='Exterior drawing and operator photo placement'))
        if housing:
            x,y,z=point
            self.revolved(name+' lens',[(x-.06,.018,.016,z),(x,.065,.034,z),(x+.09,.022,.01,z)],
                          self.trim,center=(0,y,0),count=20)

    def cyl(self, name, a, b, radius, material, sides=20):
        axis = Vector(b)-Vector(a)
        tangent = axis.normalized()
        p = tangent.cross(Vector((1,0,0)))
        if p.length < .1:
            p = tangent.cross(Vector((0,1,0)))
        p.normalize()
        q = tangent.cross(p)
        verts = [Vector(center)+radius*(p*math.cos(i*math.tau/sides)+q*math.sin(i*math.tau/sides))
                 for center in (a,b) for i in range(sides)]
        faces = [(i,(i+1)%sides,sides+(i+1)%sides,sides+i) for i in range(sides)]
        faces += [tuple(reversed(range(sides))),tuple(range(sides,2*sides))]
        return self.mesh(name,verts,faces,material)

    def pylon(self,name,engine,sign):
        x,y,z,length,r=engine
        if self.key=='e295':
            rows=[(z+.51*r,x+.54,x+length*.92,.23),(z+1.03*r,x+.42,x+length*1.1,.24),
                  (self.wing_point(self.config['wing'],y,.39,sign)[2]+.02,x+1.05,x+length*1.13,.28)]
            rings=[]
            for p,l,t,w in rows:
                rings.append([(l+(t-l)*(.5-.5*math.cos(j*math.tau/32)),
                               sign*y+w*math.sin(j*math.tau/32),p) for j in range(32)])
            verts=sum(rings,[])
            faces=[(32*i+j,32*i+(j+1)%32,32*(i+1)+(j+1)%32,32*(i+1)+j)
                   for i in range(2) for j in range(32)]
            return self.mesh(name,verts,faces,self.white,reverse=True)
        rows=[(.65,x+.55,x+length*.99,z-.15,.16),
              (y-r*.58,x+.76,x+length*.89,z-.085,.16),(y-r*.20,x+.97,x+length*.85,z,.14)]
        return self.wing_panel(name,rows,rows[0][0],rows[-1][0],0,1,sign,self.white)

    def engine(self, sign, side):
        x,y,z,length,r = self.config['engine']
        origin=(x,sign*y,z)
        self.pylon(side+' engine pylon',self.config['engine'],sign)
        def rings(spec):
            return [(a*length,b*r,b*r,c*r) for a,b,c in spec]
        def shell(name, points, mat, **kw):
            return self.revolved(side+' '+name,rings(points),mat,origin,**kw)
        lip=[(.022,.785,0),(.006,.842,0),(0,.913,0),(.013,.97,0),(.044,.987,0)]
        shell('inlet lip',lip,self.edge)
        shell('forward nacelle', [(.043,.986,0),(.119,1,0),(.28,.991,.018),
                                  (.42,.965,.026),(.56,.91,.035)],self.nacelle)
        shell('intake acoustic duct',[(.19,.78,0),(.085,.802,0),(.021,.785,0)],self.liner)
        shell('fan cavity',[(.35,.755,0),(.19,.78,0)],self.duct)
        fanx=x+length*.188
        fan = self.fan(side,fanx,sign*y,z,r*.76)
        spinner = shell('spinner',[(.11,.018,0),(.12,.105,0),(.15,.198,0),(.191,.264,0)],self.hot,count=48)
        self.motion('fans','spin',[fan,spinner],(1,0,0),(fanx,sign*y,z),spin=sign)
        shell('exhaust cone',[(.64,.45,0),(.84,.44,0),(.96,.36,0),(1,.06,0)],self.hot)
        if self.config.get('reverserType')=='none':
            shell('fixed aft nacelle',[(.56,.91,.035),(.69,.847,.047),(.83,.744,.049),
                                       (.96,.60,.047),(.985,.51,.047)],self.nacelle)
            shell('tailpipe',[(.985,.51,.047),(1,.49,.047),(.995,.444,.047),
                              (.83,.44,.047)],self.hot)
        elif self.key=='e295':
            shell('recessed reverser cascade backing',[(.545,.8,.035),(.75,.72,.035)],self.duct)
            for i in range(10):
                a=i*math.tau/10
                shell(f'cascade vane bank {i+1}',[(.55,.84,.035),(.65,.79,.035),(.73,.756,.035)],
                      self.steel, count=6, angles=(a,a+.084))
            sleeve=shell('translating reverser sleeve',[(.56,.91,.035),(.64,.865,.038),(.76,.80,.04),
                                                        (.825,.735,.04),(.834,.694,.04)],self.white)
            self.motion('reversers','translate',[sleeve],(1,0,0),origin,length*.14)
            shell('bypass nozzle',[(.835,.695,.04),(.84,.651,.04),(.76,.664,.04)],self.hot)
        else:
            for direction,name in ((1,'upper'),(-1,'lower')):
                angles = (.025,math.pi-.025) if direction>0 else (math.pi+.025,math.tau-.025)
                bucket=shell(name+' reverser door',[(.56,.91,.035),(.69,.847,.047),(.83,.744,.049),
                                                     (.966,.60,.047),(.98,.55,.047),(.96,.52,.047)],
                             self.white,count=32,angles=angles)
                self.motion('reversers','rotate',[bucket],(0,1,0),(x+length*.68,sign*y,z+.08),-direction*33)
            shell('tailpipe',[(.985,.51,.047),(1,.49,.047),(.995,.444,.047),(.83,.44,.047)],self.hot)

    def fan(self,side,x,y,z,radius):
        verts,faces=[],[]
        blade_count=20 if self.key=='e295' else 24
        for i in range(blade_count):
            base=len(verts)
            for j in range(6):
                s=j/5
                r=radius*(.31+.69*s)
                angle=i*math.tau/blade_count+.29*s*s
                chord=.20-.087*s
                for a,depth in ((angle-chord*.31,.019),(angle+chord*.52,-.027),
                                (angle+chord*.62,-.006),(angle-chord*.23,.044)):
                    verts.append((x+depth*radius+.16*radius*(1-s),y+r*math.cos(a),z+r*math.sin(a)))
            for j in range(5):
                for k in range(4):
                    m=base+4*j+k
                    n=base+4*j+(k+1)%4
                    faces.append((m,n,n+4,m+4))
            faces += [(base+3,base+2,base+1,base),(base+20,base+21,base+22,base+23)]
        return self.mesh(side+' turbofan blades',verts,faces,self.blade)

    def wheel(self,name,x,y,r,w):
        rows=[(-w*.52,.57),(-w*.50,.8),(-w*.39,.943),(-w*.2,1),(0,1),
              (w*.2,1),(w*.39,.943),(w*.50,.8),(w*.52,.57)]
        tire=self.revolved(name+' tire',[(a,b*r,b*r,0) for a,b in rows],self.rubber,(x,y,r),'Y',52)
        result=[tire]
        for sign in (-1,1):
            hub=self.revolved(name+(' inboard' if sign<0 else ' outboard')+' hub',
                             [(sign*w*.526,r*t,r*t,0) for t in (.008,.28,.56)],self.steel,
                             (x,y,r),'Y',40,angles=(0,math.tau))
            if sign<0:
                hub.data.flip_normals()
            result.append(hub)
            for i in range(6):
                a=i*math.tau/6
                sx,sz=x+.36*r*math.cos(a),r+.36*r*math.sin(a)
                result.append(self.cyl(f'{name} hub fastener {sign} {i+1}',
                                       (sx,y+sign*w*.523,sz),(sx,y+sign*w*.55,sz),r*.043,self.bay,10))
        return result

    def gear(self):
        nose,main,track,nose_r,main_r=self.config['gear']
        review={}
        for label,x,y,r,side in (('Nose',nose,0,nose_r,0),('Port main',main,-track/2,main_r,-1),
                                  ('Starboard main',main,track/2,main_r,1)):
            if side:
                deck = self.wing_point(self.config['wing'],abs(y),.76,side,-1)[2]
                top = min(deck+.15,self.config.get('maxGearPivot',3))
            else:
                cz,_,rz=stations(self.profile,x)
                top = cz-rz+.16
            pivot=(x-.18 if side else x+.05,y,top)
            axle=(x,y,r)
            half=r*.34
            w=r*.38
            parts=self.wheel(label+' wheel 1',x,y-half,r,w)+self.wheel(label+' wheel 2',x,y+half,r,w)
            parts.extend([
                self.cyl(label+' axle',(x,y-half-w*.4,r),(x,y+half+w*.4,r),r*.22,self.steel),
                self.cyl(label+' oleo piston',axle,(x,y,r+.52*(top-r)),r*.19,self.chrome),
                self.cyl(label+' upper strut',(x,y,r+.46*(top-r)),pivot,r*.27,self.steel),
                self.cyl(label+' drag brace',(x,y,r+.51*(top-r)),(x-r*1.34,y*.83,top-.1),
                         r*.1,self.steel),
            ])
            axis=(1,0,0) if side else (0,1,0)
            angle=-91*side if side else -95
            self.motion('gear','rotate',parts,axis,pivot,-angle,angle)
            self.gear_parts.extend(parts)
            if not side:
                review['gear']=(x,0,r+.19)
                self.light('Nose gear taxi light','taxi',(x-.105,0,r*1.85),'white',False)
            self.gear_doors(label,x,y,top,r,side)
        return review

    def gear_doors(self,label,x,y,top,r,side):
        # Closed panels conform to the lower fuselage or wing underskin.
        w=r*.79
        for sign in (-1,1):
            hinge_y=y+sign*w
            def skin(px,py):
                if not side:
                    cz,ry,rz=stations(self.profile,px)
                    return cz-rz*math.sqrt(max(.04,1-(py/ry)**2))-.017
                rows=self.config['wing']
                a,b,_,_=stations(rows,abs(py))
                u=min(.985,max(.05,(px-a)/(b-a)))
                return self.wing_point(rows,abs(py),u,side,-1)[2]-.024
            grid=[(px,py,skin(px,py)) for px in line(x-r*1.49,x+r*1.34,.14)
                  for py in np.linspace(min(y,hinge_y),max(y,hinge_y),6)]
            faces=[(i*6+j,i*6+j+1,(i+1)*6+j+1,(i+1)*6+j)
                   for i in range(len(grid)//6-1) for j in range(5)]
            door=self.mesh(label+f' gear door {sign}',grid,faces,self.wing if side else self.white)
            door.data.materials[0].use_backface_culling=False
            self.motion('gear','rotate',[door],(1,0,0),(x,hinge_y,skin(x,hinge_y)),
                        curve=((0,0),(.18,sign*78),(.79,sign*78),(1,sign*76 if not side else sign*54)))

    def antennae(self):
        for i,(x,scale) in enumerate(self.config['antennae']):
            cz,_,rz=stations(self.profile,x)
            z=cz+rz-.016
            self.foil_tip('Dorsal antenna '+str(i+1),[(0,x-.08,x+.24,z,.042),
                          (.003,x+.05,x+.23,z+scale,.024),(.005,x+.12,x+.22,z+scale+.01,.002)],
                          0,1,self.white)
        for sign,label in ((-1,'Port'),(1,'Starboard')):
            p=self.side(self.config['cockpit'][1][0][0],self.config['windows'][3]-.36,sign,.06)
            self.cyl(label+' pitot probe',(p[0]+.24,p[1]*.96,p[2]),p,.022,self.edge,12)

    def export(self):
        self.fuselage()
        self.glazing()
        self.wings()
        self.tail()
        if self.config.get('propellerAssemblies'):
            from fleet_geometry_details import add_propellers
            add_propellers(self.objects,self.root,self.motions,self.config['propellerAssemblies'])
        else:
            for sign,side in ((-1,'Port'),(1,'Starboard')):
                self.engine(sign,side)
        review = self.gear()
        self.antennae()
        e=self.config['engine']
        w=self.config['wing']
        review.update(cockpit=(self.config['cockpit'][0][0][0],0,self.config['cockpit'][0][0][1]),
                      door=self.side(self.config['doors'][0][0][0],self.config['windows'][3],-1),
                      wing=self.wing_point(w,self.span*.24,.58,-1),
                      engine=(e[0]+e[3]*.68,-e[1],e[2]))
        low=[min(v.co[k] for obj in self.objects for v in obj.data.vertices) for k in range(3)]
        high=[max(v.co[k] for obj in self.objects for v in obj.data.vertices) for k in range(3)]
        rig=dict(aircraft=self.key,label=self.config['label'],livery=self.livery,
                 referenceDimensions=self.config['dimensions'], axes='X aft; Y up; Z port',
                 bounds={'min':[low[0],low[2],-high[1]],'max':[high[0],high[2],-low[1]]},
                 motions=self.motions, gearInternalParts=[o['sourceName'] for o in self.gear_parts],
                 gearInternalPartIds=[o['sourcePartId'] for o in self.gear_parts],
                 missingTextures=[], provenance=self.config['source'], originalGeometry=True,
                 capabilities=sorted({m['control'] for m in self.motions}),
                 category=self.config.get('category','jet'),
                 expectedAnimations=self.config.get('expectedAnimations',
                     ['Gear','Flaps','Spoilers','Fans'] if self.config.get('reverserType')=='none' else ['Gear','Flaps','Reversers','Spoilers','Fans']),
                 minimumCabinSpanRatio=self.config.get('minimumCabinSpanRatio',.24),
                 minimumCabinWindowMeshes=self.config.get('minimumCabinWindowMeshes',10),
                 reviewPoints={k:gltf(v) for k,v in review.items()},unresolvedMotions=[],
                 fidelityNotes=self.config['notes'],reviewStatus='build-awaiting-validation')
        if self.config.get('sectionReference'):
            rig['sectionReference']=self.config['sectionReference']
        (self.folder/'lights.json').write_text(json.dumps(self.lights,indent=2)+'\n')
        stem=self.livery['id']
        (self.output/(stem+'.rig.json')).write_text(json.dumps(rig,indent=2)+'\n')
        bpy.context.scene.unit_settings.system='METRIC'
        bpy.ops.wm.save_as_mainfile(filepath=str(self.folder/(stem+'.blend')),compress=True,copy=True)
        bpy.ops.export_scene.gltf(filepath=str(self.output/(stem+'.glb')), export_format='GLB',
                                  export_extras=True,export_yup=True,export_cameras=False,
                                  export_lights=False,export_animations=False)
        print('REFERENCE JET EXPORTED', self.key, stem, len(self.objects),'meshes',rig['bounds'],flush=True)


def build(base,key,config,livery):
    Jet(base,key,config,livery).export()
