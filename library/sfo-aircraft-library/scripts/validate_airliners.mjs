import {readFile,writeFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import validator from 'gltf-validator';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Box3,Vector3,AnimationMixer,LoopOnce,MeshStandardMaterial,Texture} from 'three';
import {motionMatrix,motionValue,loadAirliner} from '../viewer/airliner-runtime.js';
const base=new URL('../assets/airliners/',import.meta.url),summary=[];
function glb(doc,bin){
 const raw=Buffer.from(JSON.stringify(doc)),j=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),h=Buffer.alloc(20),bh=Buffer.alloc(8);
 h.writeUInt32LE(0x46546c67);h.writeUInt32LE(2,4);h.writeUInt32LE(28+j.length+bin.length,8);h.writeUInt32LE(j.length,12);h.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([h,j,bh,bin]);
}
for(const key of ['a320neo','b738'])for(const file of (await readdir(new URL(key+'/exports/',base))).filter(f=>f.endsWith('.glb'))){
 const dir=new URL(key+'/exports/',base),b=await readFile(new URL(file,dir));
 const report=await validator.validateBytes(new Uint8Array(b),{maxIssues:10000,uri:file});
 await writeFile(new URL(file.replace('.glb','.validation.json'),dir),JSON.stringify(report,null,2));
 assert.equal(report.issues.numErrors,0,key+'/'+file+' GLB errors');assert.equal(report.issues.numWarnings,0,key+'/'+file+' GLB warnings');
 const n=b.readUInt32LE(12),doc=JSON.parse(b.subarray(20,20+n)),bin=b.subarray(28+n),rig=JSON.parse(await readFile(new URL(file.replace('.glb','.rig.json'),dir),'utf8'));
 assert.equal(rig.missingTextures.length,0,'Missing source textures');
 assert.equal(doc.animations.length,5);assert(doc.images.length>=3);
 for(const m of rig.motions)for(const v of [0,.25,.5,.75,1]){
  const s={gear:1,flaps:0,reversers:0,spoilers:0,engineSpeed:.5};s[m.control]=v;
  const matrix=motionMatrix(m,motionValue(m,s,.5));assert(matrix.elements.every(Number.isFinite),'Nonfinite rig transform');assert(Math.abs(matrix.determinant()-1)<1e-6,'Rig changes part scale');
 }
 // Independent Three.js geometry/animation import. Images are omitted only in
 // this headless copy, so browser image APIs are unnecessary for the check.
 const copy=structuredClone(doc);delete copy.images;delete copy.textures;delete copy.materials;
 for(const mesh of copy.meshes)for(const p of mesh.primitives)delete p.material;
 const geometryOnly=glb(copy,bin),loaded=await new GLTFLoader().parseAsync(geometryOnly.buffer.slice(geometryOnly.byteOffset,geometryOnly.byteOffset+geometryOnly.length),'');
 const size=new Box3().setFromObject(loaded.scene).getSize(new Vector3());
 const dimensions={length:size.x,span:size.z,height:size.y};
 assert(Math.abs(dimensions.length/rig.referenceDimensions.length-1)<.005,'Length differs >0.5% from manufacturer reference');
 assert(Math.abs(dimensions.span/rig.referenceDimensions.span-1)<.005,'Span differs >0.5% from manufacturer reference');
 let wheel;loaded.scene.traverse(o=>{if(key==='a320neo'?o.userData.sourceName==='NLGWheels':o.userData.sourceName==='Tires'&&o.userData.sourceModel==='Models/NoseGear.xml')wheel=o;});assert(wheel,'No nose wheel mesh');
 const mixer=new AnimationMixer(loaded.scene),gear=mixer.clipAction(loaded.animations.find(a=>a.name==='Gear'));gear.setLoop(LoopOnce,1);gear.clampWhenFinished=true;gear.play();
 mixer.setTime(.02);const up=new Box3().setFromObject(wheel).getCenter(new Vector3());
 mixer.setTime(1);const down=new Box3().setFromObject(wheel).getCenter(new Vector3());
 assert(up.y-down.y>1,'Native Gear clip does not retract wheel upward');// Repeated cycles and interrupted reversals must return every channel to exactly
 // the same endpoint; this catches accumulated transforms and stale parts.
 mixer.setTime(0);loaded.scene.updateMatrixWorld(true);
 const snapshot=()=>{const out=[];loaded.scene.traverse(o=>{if(o.isMesh)out.push(...o.matrix.elements);});return out;};
 const originalUp=snapshot();
 for(const t of [1,.3,.81,.1,1,0,.67,.22,1,0,1,0])mixer.setTime(t);
 assert.deepEqual(snapshot(),originalUp,'Gear cycle left stale transforms');
 if(key==='a320neo'){assert.equal(wheel.scale.x,0,'Enclosed gear hardware remains at fully stowed endpoint');assert(rig.gearInternalParts.length>35);}
 const cockpit=doc.materials.find(m=>m.extras?.cockpitGlazing);assert(cockpit,'Missing dedicated cockpit glazing');
 assert(!cockpit.pbrMetallicRoughness.baseColorTexture,'Pale paint map overrides cockpit tint');
 assert((cockpit.alphaMode||'OPAQUE')==='OPAQUE','Cockpit exposes empty interior');
 if(key==='b738'){
  assert.equal(doc.nodes.filter(n=>n.extras?.cabinDoorWindow).length,4,'Missing door panes');
  const extent=n=>doc.accessors[doc.meshes[n.mesh].primitives[0].attributes.POSITION];
  const cascades=doc.nodes.filter(n=>n.extras?.sourceName?.startsWith('ReverserCascade'));
  assert.equal(cascades.length,2);
  for(const n of cascades){const a=extent(n),side=Math.sign(a.min[2]+a.max[2]);
   const backing=doc.nodes.find(n=>n.extras?.sourceName==='lreverserib_0'&&Math.sign(extent(n).min[2]+extent(n).max[2])===side);
   const b=extent(backing);for(let k=0;k<3;k++)assert(a.min[k]>b.min[k]&&a.max[k]<b.max[k],'Cascade protrudes outside engine backing envelope');
  }
 }else{
  const mask=JSON.parse(await readFile(new URL('a320neo/generated/window-mask.json',base),'utf8'));
  assert.equal(mask.passengerDoorWindows.length,4,'Door emission mask omitted panes');
  for(const motion of rig.motions.filter(m=>m.control==='gear'))for(const name of motion.targets){
   if(!name.toLowerCase().includes('door')&&doc.nodes.some(n=>n.extras?.sourceName===name))assert(rig.gearInternalParts.includes(name),'Gear hardware omitted from stow mask: '+name);
  }
 }
 mixer.stopAllAction();mixer.uncacheRoot(loaded.scene);
 // Exercise the actual public controller, replacing only network/image transport.
 // This checks mid-travel reversals, frame-rate variation and cabin on/off state.
 const materialCopies=doc.materials.map(m=>{const mat=new MeshStandardMaterial();mat.name=m.name;mat.userData=m.extras||{};if(m.emissiveTexture)mat.emissiveMap=new Texture();return mat;});
 loaded.scene.traverse(o=>{if(!o.isMesh)return;const ix=loaded.parser.associations.get(o)?.nodes;
  if(ix!==undefined)o.material=materialCopies[doc.meshes[doc.nodes[ix].mesh].primitives[0].material];
 });
 const previousFetch=globalThis.fetch,previousLoad=GLTFLoader.prototype.loadAsync;
 globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL(url,'file:///'),'utf8'))});
 GLTFLoader.prototype.loadAsync=async()=>({scene:loaded.scene});
 let runtime;
 try{runtime=await loadAirliner({aircraft:key,livery:file.replace('.glb',''),baseURL:base.pathname});}
 finally{globalThis.fetch=previousFetch;GLTFLoader.prototype.loadAsync=previousLoad;}
 runtime.setState({gear:0,engineSpeed:0},{instant:true});const startUp=snapshot();
 let seconds=0;
 for(let cycle=0;cycle<12;cycle++){
  for(const target of [1,.25,.8,0]){
   runtime.setState({gear:target});
   for(let frame=0;frame<43;frame++){const dt=[1/30,1/60,1/120,.05][frame%4];seconds+=dt;runtime.update(seconds,dt);}
  }
  runtime.setState({gear:0});for(let i=0;i<320;i++)runtime.update(seconds+=1/60,1/60);
  assert.deepEqual(snapshot(),startUp,'Runtime cycle left stale gear transforms');
 }
 const illuminated=[];loaded.scene.traverse(o=>{if(o.isMesh)for(const m of [o.material].flat())if(m?.userData.cabinWindow)illuminated.push(m);});
 assert(illuminated.length>=4,'Cabin emission is not wired');
 runtime.setState({cabin:true});assert(illuminated.every(m=>m.emissiveIntensity>0),'Door/cabin lights failed to turn on');
 runtime.setState({cabin:false});assert(illuminated.every(m=>m.emissiveIntensity===0),'Door/cabin lights failed to turn off');
 runtime.dispose();
 const row={aircraft:key,livery:file.replace('.glb',''),bytes:b.length,meshes:doc.meshes.length,animations:doc.animations.map(a=>a.name),dimensions,reference:rig.referenceDimensions,noseWheelRetractionRise:up.y-down.y,runtimeGearCycles:12,doorWindows:4,cockpitTint:'opaque smoke',errors:0,warnings:0};summary.push(row);console.log(JSON.stringify(row));
}
await writeFile(new URL('validation-summary.json',base),JSON.stringify(summary,null,2));
