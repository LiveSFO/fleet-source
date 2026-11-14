// Bake the same source-derived mechanism transforms used by the Three.js runtime
// into standard glTF translation/quaternion channels for other glTF applications.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {Matrix4,Vector3,Quaternion} from 'three';
import {motionValue,motionMatrix,gearInternalScale,matchesMotion} from '../viewer/airliner-runtime.js';
const root=new URL('../assets/airliners/',import.meta.url);
for(const key of (await readdir(root,{withFileTypes:true})).filter(d=>d.isDirectory()&&!['preparation','previews','reference','traffic','build-logs'].includes(d.name)).map(d=>d.name)){
 const dir=new URL(key+'/exports/',root);
 for(const filename of (await readdir(dir)).filter(n=>n.endsWith('.glb'))){
  const file=new URL(filename,dir),b=await readFile(file),jl=b.readUInt32LE(12),doc=JSON.parse(b.subarray(20,20+jl));
  if(doc.asset.extras?.airlinerAnimationsVersion===1){console.log(key,filename,'already baked');continue;}
  const rig=JSON.parse(await readFile(new URL(filename.replace('.glb','.rig.json'),dir),'utf8'));
  const data=[b.subarray(28+jl,28+jl+b.readUInt32LE(20+jl))];let length=data[0].length;
  // glTF PNGs use the standard sRGB interpretation. Remove ancillary profile,
  // resolution and gamma chunks that trigger portability warnings; IDAT pixel
  // data and alpha remain byte-for-byte unchanged.
  for(const image of doc.images||[]){
   if(image.mimeType!=='image/png'||image.bufferView===undefined)continue;
   const view=doc.bufferViews[image.bufferView],start=view.byteOffset||0,bytes=data[0].subarray(start,start+view.byteLength),chunks=[bytes.subarray(0,8)];
   for(let off=8;off+12<=bytes.length;){const n=bytes.readUInt32BE(off),type=bytes.toString('ascii',off+4,off+8);if(!['iCCP','gAMA','cHRM','pHYs','sRGB'].includes(type))chunks.push(bytes.subarray(off,off+n+12));off+=n+12;}
   const clean=Buffer.concat(chunks);clean.copy(data[0],start);view.byteLength=clean.length;
  }
  function add(bytes){const padding=(4-length%4)%4;if(padding){data.push(Buffer.alloc(padding));length+=padding;}const offset=length;data.push(bytes);length+=bytes.length;return offset;}
  function accessor(array,type,count,min,max){
   const bytes=Buffer.from(new Float32Array(array).buffer),offset=add(bytes),view=doc.bufferViews.length;
   doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});const index=doc.accessors.length;
   doc.accessors.push({bufferView:view,componentType:5126,count,type,...(min?{min,max}:{} )});return index;
  }
  doc.animations=[];const frames=65,times=Array.from({length:frames},(_,i)=>i/(frames-1));
  const timeAccessor=accessor(times,'SCALAR',frames,[0],[1]);
  for(const [control,name] of [['gear','Gear'],['flaps','Flaps'],['reversers','Reversers'],['spoilers','Spoilers'],['fans','Fans']]){
   const clip={name,channels:[],samplers:[],extras:{inputRange:[0,1],description:control==='gear'?'0 retracted, 1 extended':control==='fans'?'Looping display fan rotation':'0 stowed, 1 deployed'}};
   for(let index=0;index<doc.nodes.length;index++){
    const node=doc.nodes[index];if(node.mesh===undefined||!node.extras?.sourceName)continue;
    const motions=rig.motions.filter(m=>matchesMotion(m,node.extras)&&(m.control===control||(control==='flaps'&&m.control==='slats')));
    const internal=control==='gear'&&(rig.gearInternalPartIds?rig.gearInternalPartIds.includes(node.extras.sourcePartId):rig.gearInternalParts?.includes(node.extras.sourceName));
    if(!motions.length&&!internal)continue;const translations=[],rotations=[],scales=[];let last=null;
    for(const t of times){
     const state={gear:1,flaps:0,reversers:0,spoilers:0,engineSpeed:control==='fans'?1:0};state[control]=t;
     const matrix=new Matrix4();for(const m of motions)matrix.multiply(motionMatrix(m,motionValue(m,state,t)));
     const p=new Vector3(),q=new Quaternion(),s=new Vector3();matrix.decompose(p,q,s);
     if(last&&q.dot(last)<0)q.set(-q.x,-q.y,-q.z,-q.w);last=q.clone();translations.push(...p);rotations.push(...q);if(internal)scales.push(...Array(3).fill(gearInternalScale(t)));
    }
    for(const [path,type,values] of [['translation','VEC3',translations],['rotation','VEC4',rotations],...(internal?[['scale','VEC3',scales]]:[])]){
     const output=accessor(values,type,frames),sampler=clip.samplers.length;clip.samplers.push({input:timeAccessor,output,interpolation:'LINEAR'});clip.channels.push({sampler,target:{node:index,path}});
    }
   }
   if(clip.channels.length)doc.animations.push(clip);
  }
  // Embed the cabin-window mask, while retaining the dark cabin as the default.
  if(key==='a320neo'){
   const bytes=await readFile(new URL('a320neo/generated/cabin-window-emission.png',root)),offset=add(bytes),view=doc.bufferViews.length;
   doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});const image=doc.images.length;
   doc.images.push({name:'Cabin window emission mask',mimeType:'image/png',bufferView:view});const texture=doc.textures.length;
   doc.textures.push({source:image});
   for(const m of doc.materials)if(m.name.includes('fuselage_')){m.emissiveTexture={index:texture};m.emissiveFactor=[0,0,0];m.extras={...m.extras,cabinWindow:true};}
  }
  for(const material of doc.materials)if(material.extras?.cabinWindow)material.emissiveFactor=[0,0,0];
  doc.asset.extras={...doc.asset.extras,airlinerAnimationsVersion:1,source:rig.originalGeometry?'Original exterior geometry based on published airframe drawings; see rig provenance':'Exterior mesh and hinge definitions; see rig provenance and source notices',adaptationDate:'2026-11-11'};
  const padding=(4-length%4)%4;if(padding){data.push(Buffer.alloc(padding));length+=padding;}doc.buffers[0].byteLength=length;
  const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),binary=Buffer.concat(data),header=Buffer.alloc(20),bh=Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(binary.length,0);bh.writeUInt32LE(0x004e4942,4);
  await writeFile(file,Buffer.concat([header,json,bh,binary]));console.log(key,filename,doc.animations.map(c=>c.name+':'+c.channels.length).join(', '));
 }
}
