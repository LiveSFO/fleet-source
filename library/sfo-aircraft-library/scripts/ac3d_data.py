"""Small data-only AC3D reader. Retains named parts, face UVs and materials."""
import shlex,pathlib
def read_ac(path):
 f=open(path,encoding='utf-8',errors='replace');header=f.readline().strip()
 if not header.startswith('AC3D'):raise ValueError(path)
 materials=[]
 def obj(first):
  o={'type':first.split()[1],'name':'','verts':[],'faces':[],'children':[],'loc':[0,0,0],'rot':[1,0,0,0,1,0,0,0,1],'texture':None,'texrep':[1,1],'texoff':[0,0],'crease':45}
  while True:
   line=f.readline()
   if not line:raise ValueError('Unexpected end of '+str(path))
   s=shlex.split(line)
   if not s:continue
   k=s[0]
   if k=='name':o['name']=s[1]
   elif k=='data':f.read(int(s[1]));f.readline()
   elif k=='texture':o['texture']=s[1]
   elif k in ('loc','rot','texrep','texoff'):o[k]=[float(q) for q in s[1:]]
   elif k=='crease':o[k]=float(s[1])
   elif k=='numvert':o['verts']=[[float(q) for q in f.readline().split()] for _ in range(int(s[1]))]
   elif k=='numsurf':
    for _ in range(int(s[1])):
     surf=0;mat=0
     while True:
      line=f.readline()
      if not line:raise ValueError('Unexpected EOF inside surface in '+str(path))
      z=line.split()
      if not z:continue
      if z[0]=='SURF':surf=int(z[1],16)
      elif z[0]=='mat':mat=int(z[1])
      elif z[0]=='refs':
       refs=[f.readline().split() for _ in range(int(z[1]))]
       if (surf&15)==0 and len(refs)>2:o['faces'].append({'v':[int(q[0]) for q in refs],'uv':[[float(q[1]),float(q[2])] for q in refs],'mat':mat,'surf':surf})
       break
   elif k=='kids':
    count=int(s[1])
    # This pinned upstream engine declares 9 world children but contains 8.
    # Preserve all eight supplied objects; do not synthesize an absent child.
    if o['type']=='world' and pathlib.Path(path).name=='PW_PurePower_1100G.ac' and count==9:count=8
    for _ in range(count):
     line=f.readline()
     while not line.strip():
      if not line:raise ValueError('Unexpected EOF in child list in '+str(path))
      line=f.readline()
     if not line.startswith('OBJECT '):raise ValueError(line)
     o['children'].append(obj(line))
    return o
 while True:
  line=f.readline()
  if not line:break
  if line.startswith('MATERIAL'):
   s=shlex.split(line);m={'name':s[1]}
   for k,n in [('rgb',3),('amb',3),('emis',3),('spec',3),('shi',1),('trans',1)]:
    i=s.index(k,2);v=[float(q) for q in s[i+1:i+1+n]];m[k]=v if n>1 else v[0]
   materials.append(m)
  elif line.startswith('OBJECT '):return materials,obj(line)
 raise ValueError('No world in '+str(path))

if __name__=='__main__':
 import sys,json,collections
 for path in sys.argv[1:]:
  mats,root=read_ac(path);objects=[]
  def walk(o):
   if o['verts']:objects.append(o)
   for c in o['children']:walk(c)
  walk(root)
  print(path,len(objects),'parts',sum(len(o['faces']) for o in objects),'polygons')
  print(json.dumps([{'name':o['name'],'texture':o['texture'],'verts':len(o['verts'])} for o in objects][:12]))
