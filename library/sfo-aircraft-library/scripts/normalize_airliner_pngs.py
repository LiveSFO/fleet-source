"""Remove glTF-incompatible ancillary PNG metadata; retain compressed pixels."""
import json,struct,pathlib
root=pathlib.Path(__file__).resolve().parents[1]/'assets/airliners'
for path in root.glob('*/exports/*.glb'):
 b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];doc=json.loads(b[20:20+n]);binary=bytearray(b[28+n:]);changed=0
 for image in doc.get('images',[]):
  if image.get('mimeType')!='image/png' or 'bufferView' not in image:continue
  v=doc['bufferViews'][image['bufferView']];start=v.get('byteOffset',0);raw=bytes(binary[start:start+v['byteLength']]);chunks=[raw[:8]];off=8
  while off+12<=len(raw):
   length=struct.unpack_from('>I',raw,off)[0];kind=raw[off+4:off+8]
   if kind not in [b'iCCP',b'gAMA',b'cHRM',b'pHYs',b'sRGB']:chunks.append(raw[off:off+length+12])
   off+=length+12
  clean=b''.join(chunks)
  if len(clean)!=len(raw):binary[start:start+len(clean)]=clean;v['byteLength']=len(clean);changed+=1
 if changed:
  j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4)
  path.write_bytes(struct.pack('<5I',0x46546c67,2,28+len(j)+len(binary),len(j),0x4e4f534a)+j+struct.pack('<2I',len(binary),0x004e4942)+binary)
 print(path.name,changed,'PNG headers normalized')
