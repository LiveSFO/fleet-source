"""Original Trent 7000 exterior, using Airbus's published nacelle stations.

Airbus A330 AC, Dec 2025, 2-12-0 page 20, figure 991-027-A01.
The manual labels these approximate dimensions. Cascades, blades and pylon
sections are authored visualization details, not an engineering reconstruction.
"""
import math
import bpy
from mathutils import Vector


def add_trent7000(objects,motions,root,cfg):
    old=[o for o in objects if o.get('sourceModel')=='Models/trent772b-60.xml']
    ids={o['sourcePartId'] for o in old}
    for ob in old:objects.remove(ob);bpy.data.objects.remove(ob,do_unlink=True)
    for motion in motions:motion['targetPartIds']=[p for p in motion['targetPartIds'] if p not in ids]
    motions[:]=[m for m in motions if m['targetPartIds']]
    nose=min(v.co.x for o in objects for v in o.data.vertices)
    aft=max(v.co.x for o in objects for v in o.data.vertices)
    axial_scale=(aft-nose)/cfg['dimensions']['length']
    front=nose+21.05*axial_scale
    spec=cfg['trent7000Exterior']
    cy,cz=spec.get('centerline',9.30),spec.get('axisHeight',-2.47)

    def material(name,color,metallic,roughness,coat=0):
        m=bpy.data.materials.new('Trent 7000 '+name);m.use_nodes=True
        shader=m.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value=(*color,1)
        shader.inputs['Metallic'].default_value=metallic
        shader.inputs['Roughness'].default_value=roughness
        shader.inputs['Coat Weight'].default_value=coat
        return m
    white=material('painted nacelle',(.89,.90,.89),.08,.27,.36)
    edge=material('inlet lip',(.47,.50,.53),.88,.23)
    dark=material('duct and panel seals',(.016,.022,.027),.12,.47)
    blade=material('titanium fan blades',(.21,.24,.27),.76,.28)
    hot=material('exhaust alloy',(.13,.12,.11),.86,.38)
    cascade=material('reverser composite cascades',(.13,.17,.14),.23,.47)
    added=[]

    def mesh(name,vertices,faces,mat):
        data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces)
        data.materials.append(mat)
        for face in data.polygons:face.use_smooth=True
        data.update()
        ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob);ob.parent=root
        ob['sourceName']=name;ob['sourcePartId']=name
        ob['sourceModel']='Original Trent 7000 exterior'
        objects.append(ob);added.append(ob)
        return ob

    def motion(control,kind,parts,sign,travel=1):
        names=[o['sourcePartId'] for o in parts]
        motions.append(dict(control=control,type=kind,property='authored/trent7000/'+control,
                            factor=travel,offset=0,axis=[1,0,0],center=[front,cz,-sign*cy],
                            interpolation=[],min=None,max=None,spinDirection=sign,
                            targets=names,targetPartIds=names,model='Original Trent 7000 exterior'))

    # Sections are axial distance from inlet datum, width, upper and lower radii.
    # A=1.39, B=3.59, C=5.57. Intermediate stations follow the smooth drawing.
    sections=[(.12,3.37,1.65,1.69),(.27,3.52,1.72,1.78),(.64,3.64,1.78,1.84),
              (1.00,3.70,1.805,1.875),(1.39,3.71,1.81,1.88),
              (2.20,3.69,1.79,1.88),(3.00,3.66,1.765,1.865),
              (3.59,3.63,1.75,1.85),(4.20,3.44,1.66,1.76),
              (4.87,3.19,1.55,1.64),(5.57,2.91,1.45,1.50)]

    def section(x):
        for a,b in zip(sections,sections[1:]):
            if x<=b[0]:
                t=max(0,min(1,(x-a[0])/(b[0]-a[0])))
                return tuple(a[i]+t*(b[i]-a[i]) for i in range(1,4))
        return sections[-1][1:]

    def shell(name,rows,mat,sign,n=96,arc=(0,math.tau)):
        vertices=[]
        for x,width,up,down in rows:
            for j in range(n+1):
                theta=arc[0]+(arc[1]-arc[0])*j/n
                sine=math.sin(theta)
                vertices.append((front+x*axial_scale,sign*cy+width*.5*math.cos(theta),
                                 cz+(up if sine>=0 else down)*sine))
        faces=[(i*(n+1)+j,i*(n+1)+j+1,(i+1)*(n+1)+j+1,(i+1)*(n+1)+j)
               for i in range(len(rows)-1) for j in range(n)]
        return mesh(name,vertices,faces,mat)

    for sign,label in [(-1,'Port'),(1,'Starboard')]:
        prefix=label+' Trent 7000 '
        # Folded lip connects the outer nose cowl to the 2.71 m clear inlet.
        shell(prefix+'rolled inlet lip',[(.25,2.71,1.355,1.355),(.055,2.77,1.385,1.385),
                                        (0,2.96,1.48,1.48),(.028,3.18,1.56,1.62),
                                        (.12,3.37,1.65,1.69)],edge,sign)
        shell(prefix+'nose cowl',[r for r in sections if r[0]<=1.39],white,sign)
        shell(prefix+'fan cowl',[r for r in sections if 1.39<=r[0]<=3.59],white,sign)
        shell(prefix+'acoustic inlet duct',[(.25,2.71,1.355,1.355),(.75,2.76,1.38,1.38),
                                            (1.18,2.83,1.415,1.415)],dark,sign)
        for x in [1.39,3.59]:
            w,u,v=section(x)
            shell(prefix+f'cowl joint {x}',[(x-.009,w+.009,u+.004,v+.004),
                                          (x+.009,w+.009,u+.004,v+.004)],dark,sign)
        # Two separate translating halves leave an upper pylon gap.
        sleeves=[]
        for index,(a,b) in enumerate([(-math.pi/2+.02,math.pi/2-.085),
                                     (math.pi/2+.085,3*math.pi/2-.02)]):
            sleeves.append(shell(prefix+f'smooth reverser sleeve {index+1}',
                                 [r for r in sections if r[0]>=3.59],white,sign,64,(a,b)))
        motion('reversers','translate',sleeves,sign,1.04*axial_scale)
        shell(prefix+'cascade inner backing',[(3.61,3.19,1.50,1.60),
                                              (4.60,3.03,1.42,1.51)],dark,sign)
        # Recessed cross vanes are fully enclosed in the stowed nacelle.
        for bank in range(24):
            angle=bank*math.tau/24
            shell(prefix+f'cascade bank {bank+1}',[(3.63,3.44,1.64,1.72),
                                                (4.04,3.35,1.59,1.68),
                                                (4.56,3.19,1.51,1.60)],cascade,sign,3,(angle,angle+.028))
        for ring in range(7):
            x=3.65+ring*.142
            w,u,v=section(x)
            shell(prefix+f'cascade transverse vane {ring+1}',
                  [(x,w-.14,u-.08,v-.08),(x+.024,w-.14,u-.08,v-.08)],cascade,sign)
        shell(prefix+'primary nozzle',[(4.88,1.94,.97,.97),(5.57,1.82,.91,.91),
                                       (5.88,1.74,.87,.87),(6.38,1.51,.75,.75),
                                       (6.40,1.48,.735,.735),(6.13,1.43,.71,.71)],hot,sign)
        shell(prefix+'exhaust plug',[(5.88,1.35,.675,.675),(6.38,1.29,.645,.645),
                                     (6.95,.96,.48,.48),(7.75,.35,.175,.175),
                                     (8.18,.065,.0325,.0325)],hot,sign)
        vertices=[];faces=[]
        for i in range(20):
            start=len(vertices)
            for j in range(9):
                t=j/8;radius=.34+1.05*t;theta=i*math.tau/20+.28*t*t
                for offset,depth in [(-.055,.06),(.12,-.03),(.14,-.005),(-.04,.09)]:
                    vertices.append((front+(1.20+.11*(1-t)+depth)*axial_scale,
                                     sign*cy+radius*math.cos(theta+offset),
                                     cz+radius*math.sin(theta+offset)))
            for j in range(8):
                for k in range(4):
                    q=start+j*4+k;r=start+j*4+(k+1)%4
                    faces.append((q,r,r+4,q+4))
        fan=mesh(prefix+'twisted fan blades',vertices,faces,blade)
        spinner=shell(prefix+'spinner',[(.62,.025,.0125,.0125),(.68,.23,.115,.115),
                                        (.91,.52,.26,.26),(1.22,.73,.365,.365)],hot,sign,64)
        motion('fans','spin',[fan,spinner],sign)
        # Original pylon airfoil sections bridge cowl crown to retained wing.
        levels=[(-1.10,1.05,6.00,.15),(-.50,1.45,7.23,.23),(.22,2.35,8.15,.30)]
        vertices=[]
        for z,lead,trail,halfwidth in levels:
            for j in range(65):
                theta=j*math.tau/64;u=.5-.5*math.cos(theta)
                vertices.append((front+(lead+(trail-lead)*u)*axial_scale,
                                 sign*cy+halfwidth*math.sin(theta),cz+z+2.0))
        faces=[(i*65+j,i*65+j+1,(i+1)*65+j+1,(i+1)*65+j)
               for i in range(2) for j in range(64)]
        mesh(prefix+'sculpted pylon',vertices,faces,white)

    return {'basis':'Airbus A330 Aircraft Characteristics, Dec 2025, figure 2-12-0-991-027-A01, PDF page 217. Approximate manufacturer dimensions.',
            'source':'reference/Airbus-A330-AC-2025-12.pdf','frontDistanceFromNose':21.05,
            'sections':{'A':[1.39,3.71,1.81,1.88],'B':[3.59,3.63,1.75,1.85],
                        'C':[5.57,2.91,1.45,1.50],'D':[5.88,1.74,.87,.87],
                        'E':[6.38,1.51,.75,.75]},
            'addedParts':[ob['sourceName'] for ob in added],
            'limits':'Original exterior and illustrative fan/cascade/pylon sections. No production CAD or actuator engineering claimed.'}
