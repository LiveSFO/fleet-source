"""Prepare additional dated SFO jet variants for the existing exterior builder.

The station curves are authored visual reconstructions. Manufacturer dimensions
constrain the extents. The rig notes retain the remaining engineering limits.
"""
from copy import deepcopy
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1] / 'assets/airliners'


def scaled_profile(template, dimensions):
    result = deepcopy(template)
    old = template['dimensions']
    sx = dimensions['length'] / old['length']
    sy = dimensions['span'] / old['span']
    sz = dimensions['height'] / old['height']
    for key in ('profile', 'fairing'):
        result[key] = [[x*sx, z*sz, ry*sy, rz*sz] for x,z,ry,rz in template[key]]
    for key in ('wing', 'tail', 'tip'):
        if key in template:
            result[key] = [[y*sy, a*sx, b*sx, z*sz, t*sz]
                           for y,a,b,z,t in template[key]]
    result['fin'] = [[z*sz,a*sx,b*sx,t*sy] for z,a,b,t in template['fin']]
    result['flaps'] = [[a*sy,b*sy] for a,b in template['flaps']]
    result['spoilers'] = [[a*sy,b*sy] for a,b in template['spoilers']]
    x,y,z,length,radius = template['engine']
    result['engine'] = [x*sx,y*sy,z*sz,length*sx,radius*sz]
    x,main,track,nose,tyre = template['gear']
    result['gear'] = [x*sx,main*sx,track*sy,nose*sz,tyre*sz]
    x,count,pitch,z,w,h = template['windows']
    result['windows'] = [x*sx,count,pitch*sx,z*sz,w*sx,h*sz]
    result['doors'] = [[[x*sx,z*sz,w*sx,h*sz] for x,z,w,h in side]
                       for side in template['doors']]
    result['cockpit'] = [[[x*sx,z*sz] for x,z in pane] for pane in template['cockpit']]
    result['antennae'] = [[x*sx,height*sz] for x,height in template['antennae']]
    result['dimensions'] = dimensions
    result['minimumCabinSpanRatio'] = .18
    result['notes'] = [
        'Original exterior station curves and surface lofts, constrained by the cited manufacturer dimensions and published exterior proportions.',
        'Gear linkages, fan sections and internal reverser details are illustrative. Registration paint and small antenna fittings require close-view comparison with the cited aircraft.'
    ]
    result['liveries'] = []
    return result


def stripe_paint(profile, palette, *, base='f7f6f3', fin=None):
    length = profile['profile'][-1][0]
    center = profile['profile'][7][1]
    rows = []
    for index,color in enumerate(palette):
        stations = [(0,.54),(length*.17,.71),(length*.66,.84),
                    (length*.82,.91),(length,1.38)]
        low = [[x,center*z+index*.075] for x,z in stations]
        high = [[x,z+.052] for x,z in low]
        rows.append([low,high,color])
    return {
        'base':base,'fin':fin or base,'winglet':fin or base,
        'bands':rows,
        'finBands':[[color,-.14+i*.09,-.08+i*.09,.52]
                    for i,color in enumerate(palette)]
    }


def prepare():
    profiles_path = BASE/'reference-jet-profiles.json'
    config_path = BASE/'fleet-build-config.json'
    profiles = json.loads(profiles_path.read_text())
    config = json.loads(config_path.read_text())
    specifications = [
        ('cl30','e545','Bombardier Challenger 300 · HTF7000',20.92,19.46,6.20,
         'https://smartpubs.aero.bombardier.com/viewer/api/resources/sfp-page/CH350MM/SFP/CH350/ch350/system-description/06/index.html'),
        ('cl35','e545','Bombardier Challenger 350 · HTF7350',20.92,21.00,6.12,
         'https://smartpubs.aero.bombardier.com/viewer/api/resources/sfp-page/CH350MM/SFP/CH350/ch350/system-description/06/index.html'),
        ('glf4','glf5','Gulfstream G450 · Tay 611-8C',27.23,23.72,7.67,
         'https://flexjet.com/en-us/fleet/gulfstream-g450'),
        ('glf6','glf5','Gulfstream G650ER · BR725',30.41,30.36,7.82,
         'https://www.gulfstream.com/en/aircraft/gulfstream-g650er/'),
        ('ga5c','glf5','Gulfstream G500 · PW814GA',27.78,26.31,7.87,
         'https://www.gulfstream.com/en/aircraft/gulfstream-g500/'),
        ('glex','glf5','Bombardier Global 6000 · BR710',30.30,28.65,7.80,
         'https://bombardier.com/en/aircraft/global-6000'),
        ('gl7t','glf5','Bombardier Global 7500 · Passport',33.88,31.79,8.20,
         'https://bombardier.com/en/aircraft/global-7500'),
        ('c25b','c700','Cessna Citation CJ3 · FJ44-3A',15.60,16.26,4.62,
         'https://cessna.txtav.com/citation/cj3'),
        ('c56x','c700','Cessna Citation XLS · PW545',16.00,17.17,5.23,
         'https://cessna.txtav.com/en/citation/xls-gen2'),
        ('e55p','e545','Embraer Phenom 300 · PW535E',15.64,15.91,5.10,
         'https://embraer.com/media/b4lchr5u/phenom-300e-electronic.pdf'),
        ('h25c','galx','Hawker 1000 · PW305B',16.39,15.66,5.21,
         'https://www.easa.europa.eu/en/document-library/type-certificates'),
        ('astr','galx','IAI Astra · TFE731',16.94,16.64,5.53,
         'https://www.easa.europa.eu/en/document-library/type-certificates'),
    ]
    for key,parent,label,length,span,height,reference in specifications:
        if key in profiles:
            continue
        p = scaled_profile(profiles[parent],dict(length=length,span=span,height=height))
        p['label'] = label
        p['source'] = dict(method='Original authored exterior station loft',
                           airframe=reference,
                           variantBasis='Published exterior proportions and dimensions. See fidelity notes.')
        profiles[key] = p
    # Distinct windows and propulsion envelopes keep these variants recognizable.
    for key,count in [('glf4',6),('glf6',8),('ga5c',7),('glex',7),('gl7t',10)]:
        p = profiles[key]
        p['windows'][1] = count
        start = p['windows'][0]
        end = p['engine'][0]-.8
        p['windows'][2] = (end-start)/max(1,count-1)
        if key in ('glf6','ga5c'):
            p['windows'][4:6] = [.77,.57]
        if key in ('glex','gl7t'):
            p['windows'][4:6] = [.46,.62]
    profiles['glf4']['engine'][3:] = [4.22,.76]
    profiles['glf6']['engine'][3:] = [5.00,1.01]
    profiles['ga5c']['engine'][3:] = [4.53,.94]
    profiles['glex']['engine'][3:] = [4.43,.91]
    profiles['gl7t']['engine'][3:] = [4.88,1.02]
    for key in ('cl30','cl35'):
        p = profiles[key]
        p['profile'] = [[x,z,ry*1.14,rz*1.04] for x,z,ry,rz in p['profile']]
        p['windows'][1:3] = [6,1.02]
        p['windows'][4:6] = [.37,.46]
        p['engine'][3:] = [3.31,.68]
    # The CJ3 has an unswept wing and no thrust reversers.
    p = profiles['c25b']
    p.pop('tip',None)
    p['wing'] = [[.70,5.42,8.50,1.03,.20],[1.25,5.49,8.38,1.07,.18],
                 [3.20,5.64,7.90,1.18,.135],[5.52,5.82,7.42,1.31,.08],
                 [7.77,6.01,6.98,1.43,.035],[8.13,6.11,6.92,1.45,.009]]
    p['windows'][1:3] = [6,.54]
    p['windows'][4:6] = [.26,.34]
    p['reverserType'] = 'none'
    p['engine'][3:] = [2.30,.43]
    p = profiles['c56x']
    p.pop('tip',None)
    p['wing'] = [[.75,5.70,9.27,1.03,.23],[1.20,5.79,9.02,1.08,.19],
                 [3.12,6.02,8.69,1.20,.15],[5.20,6.29,8.05,1.34,.10],
                 [7.44,6.57,7.50,1.50,.04],[8.585,6.72,7.28,1.58,.009]]
    p['windows'][1:3] = [7,.57]
    p['windows'][4:6] = [.29,.38]
    profiles['e55p']['windows'][1:3] = [6,.63]
    profiles['e55p']['reverserType'] = 'none'
    for key in ('c25b','c56x','e55p'):
        p=profiles[key]
        p['minimumCabinSpanRatio']=.17
        # Flap/spoiler span stations fit the independently authored outer wing.
        half=p['dimensions']['span']/2
        p['flaps']=[[1.18,half*.38],[half*.38,half*.68]]
        p['spoilers']=[[1.38,half*.35],[half*.37,half*.61]]
    operator_rows = {
        'cl30':[('vista-america','Vista America · Challenger 300','N539XJ'),
                ('twy-n1013','Solairus · N1013','N1013')],
        'cl35':[('flexjet','Flexjet · Challenger 350','N578FX'),
                ('netjets','NetJets · Challenger 350','N752QS'),
                ('vista-america','Vista America · Challenger 350','N360VJ')],
        'glf4':[('flexjet','Flexjet · G450','N488FX')],
        'glf6':[('thoma-bravo','Thoma Bravo · N613HB','N613HB')],
        'ga5c':[('conocophillips','ConocoPhillips · N797CP','N797CP'),
                ('jet-aviation','Jet Aviation · N503F','N503F')],
        'glex':[('netjets','NetJets · Global 6000','N166QS'),
                ('vistajet','VistaJet · 9H-VJS','9H-VJS')],
        'gl7t':[('netjets','NetJets · Global 7500','N186QS')],
        'c25b':[('jet-access','Jet Access Aviation · N327TX','N327TX'),
                ('flyexclusive','flyExclusive · N749JS','N749JS'),
                ('silver-air','Silver Air · N294PW','N294PW')],
        'c56x':[('pacific-coast','Pacific Coast Jet · N420DL','N420DL')],
        'e55p':[('netjets','NetJets · Phenom 300','N306QS')],
        'h25c':[('private-n707hd','Hawker 1000 · N707HD','N707HD')],
        'astr':[('skycare','SkyCare Air Ambulance · C-FDAX','C-FDAX')]
    }
    for key,liveries in operator_rows.items():
        p=profiles[key]
        p['liveries']=[]
        for identity,label,registration in liveries:
            colors=['a4865d','832634','27272c'] if identity=='netjets' else ['243448','7a8d9f']
            if identity=='flexjet':
                colors=['484745','a38768','813b35']
            if identity in ('vistajet','vista-america'):
                colors=['dd2133','777f88']
            if identity=='twy-n1013':
                colors=['bb292c','2b2b2d']
            paint=stripe_paint(p,colors,base='c5c9cd' if identity=='vistajet' else 'f7f6f3',
                               fin='e52032' if identity in ('vistajet','vista-america') else None)
            paint['engineMark']=dict(file=registration.lower()+'-registration.png',color='303745')
            p['liveries'].append(dict(id=identity,name=label,paint=paint))
        config[key]=dict(format='reference-loft',label=p['label'],dimensions=p['dimensions'],
                         source='reference-jet-profiles.json',
                         liveries=[dict(id=l['id'],name=l['name']) for l in p['liveries']])
    profiles_path.write_text(json.dumps(profiles,indent=2)+'\n')
    config_path.write_text(json.dumps(config,indent=2)+'\n')
    return operator_rows


if __name__=='__main__':
    for family,liveries in prepare().items():
        print(family,', '.join(l[0] for l in liveries))
