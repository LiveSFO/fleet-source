"""Repair zero-length exporter tangents at degenerate UVs; positions untouched."""
import struct,json,pathlib,math,sys

def repair(path):
 path=pathlib.Path(path);data=bytearray(path.read_bytes());jlen,jtype=struct.unpack_from('<II',data,12);doc=json.loads(data[20:20+jlen]);base=20+jlen+8;count=0
 def at(ai,i):
  a=doc['accessors'][ai];v=doc['bufferViews'][a['bufferView']];components={'VEC3':3,'VEC4':4}[a['type']]
  assert a['componentType']==5126
  return base+v.get('byteOffset',0)+a.get('byteOffset',0)+i*v.get('byteStride',components*4)
 for mesh in doc['meshes']:
  for p in mesh['primitives']:
   attrs=p['attributes']
   if 'TANGENT' not in attrs:continue
   t,n=attrs['TANGENT'],attrs['NORMAL']
   for i in range(doc['accessors'][t]['count']):
    off=at(t,i);x,y,z,w=struct.unpack_from('<4f',data,off)
    if x*x+y*y+z*z<1e-12:
     nx,ny,nz=struct.unpack_from('<3f',data,at(n,i))
     if abs(nx)<.8:v=(0,nz,-ny)
     else:v=(-nz,0,nx)
     length=math.sqrt(sum(a*a for a in v));v=tuple(a/length for a in v)
     struct.pack_into('<4f',data,off,*v,1 if w>=0 else -1);count+=1
 if count:path.write_bytes(data)
 report=dict(file=path.name,zeroTangentsRepaired=count,method='Unit vector orthogonal to the authored normal at degenerate UVs',positionsChanged=False)
 path.with_name('tangent-repair.json').write_text(json.dumps(report,indent=2));return report
if __name__=='__main__':
 for p in sys.argv[1:]:print(json.dumps(repair(p)))
