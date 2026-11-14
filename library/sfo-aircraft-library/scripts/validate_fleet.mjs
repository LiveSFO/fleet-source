import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import validator from 'gltf-validator';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Box3,Vector3,AnimationMixer,LoopOnce,MeshStandardMaterial,Texture} from 'three';
import {motionMatrix,motionValue,loadAirliner,matchesMotion} from '../viewer/airliner-runtime.js';
const base=new URL('../assets/airliners/',import.meta.url),summary=[];
const requested=new Set(process.argv.slice(2));
const sfoOnly=requested.delete('--sfo');
const scope=sfoOnly?JSON.parse(await readFile(new URL('sfo-build-coverage.json',base),'utf8')).combinations:null;
if(scope)assert(scope.every(row=>row.asset),'The SFO inventory still has combinations without exports');
const selected=scope?new Set(scope.map(({asset})=>asset.aircraft+'/'+asset.livery)):null;
const shouldCheck=(key,livery)=>selected?selected.has(key+'/'+livery):!requested.size||requested.has(key);
function glb(doc,bin){
 const raw=Buffer.from(JSON.stringify(doc)),j=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),h=Buffer.alloc(20),bh=Buffer.alloc(8);
 h.writeUInt32LE(0x46546c67);h.writeUInt32LE(2,4);h.writeUInt32LE(28+j.length+bin.length,8);h.writeUInt32LE(j.length,12);h.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([h,j,bh,bin]);
}
const keys=(await readdir(base,{withFileTypes:true})).filter(d=>d.isDirectory()&&!['preparation','previews','reference','traffic','build-logs'].includes(d.name)).map(d=>d.name);
for(const key of keys)for(const file of (await readdir(new URL(key+'/exports/',base))).filter(f=>f.endsWith('.glb')&&shouldCheck(key,f.slice(0,-4)))){
 try {
 const dir=new URL(key+'/exports/',base),b=await readFile(new URL(file,dir));
 const report=await validator.validateBytes(new Uint8Array(b),{maxIssues:10000,uri:file});
 await writeFile(new URL(file.replace('.glb','.validation.json'),dir),JSON.stringify(report,null,2));
 assert.equal(report.issues.numErrors,0,key+'/'+file+' GLB errors');assert.equal(report.issues.numWarnings,0,key+'/'+file+' GLB warnings');
 const n=b.readUInt32LE(12),doc=JSON.parse(b.subarray(20,20+n)),bin=b.subarray(28+n),rig=JSON.parse(await readFile(new URL(file.replace('.glb','.rig.json'),dir),'utf8'));
 assert.equal(rig.missingTextures.length,0,'Missing source textures');
 assert.deepEqual(doc.animations.map(a=>a.name),rig.expectedAnimations||['Gear','Flaps','Reversers','Spoilers','Fans']);assert(doc.images.length>=2);
 const sourceNames=doc.nodes.map(node=>node.extras?.sourceName||'');
 if(key==='crj200')assert(!sourceNames.some(name=>/^(LBL|UBL|LHLL|RHLL|LHNL|RHNL|LHSL|RHSL|LHTL|RHTL|LHWL|RHWL|LTNL|UTNL|NLL|TSL)$/.test(name)),'Simulator halo billboards remain on CRJ200');
 if(['b788','b789-current','b78x'].includes(key)){
  const fans=doc.materials.filter(m=>m.name?.includes('Unpainted fan blade alloy'));
  assert(fans.length&&fans.every(m=>!m.pbrMetallicRoughness?.baseColorTexture),'787 fan blades inherit an airline colour atlas');
  assert(!sourceNames.some(name=>/^eng[12]fan1$/.test(name)),'Simulator fan blur discs remain');
 }
 if(['b752','b753'].includes(key)){
  assert.equal(sourceNames.filter(name=>/^Winglet[LR]$/.test(name)).length,2,'757 winglets missing or duplicated');
  assert.equal(rig.referenceDimensions.span,41.1,'Winglet-equipped 757 uses baseline span');
 }
 if(['a221','a223'].includes(key)){
  const duct=doc.materials.filter(m=>m.name?.includes('PW1500G inner duct and core'));
  assert(duct.length&&duct.every(m=>!m.pbrMetallicRoughness?.baseColorTexture),'A220 inner engine inherits the coloured source atlas');
  if(key==='a223'&&file==='air-canada.glb')assert.equal(sourceNames.filter(name=>name.startsWith('Fitted decal ')).length,2,'Air Canada roundels must be fitted to both fin sides');
 }
 if(['b772','b77w','b77f'].includes(key))
  assert(!sourceNames.some(name=>/^spot ext$|^fuselagelumiere[-.]/i.test(name)),'Simulator light projection card is visible in the exterior mesh');
 if(key==='a35k'){
  assert.equal(sourceNames.filter(name=>/^tyres\.(left|right)\.(front|center|back)$/.test(name)).length,6,'Missing A350-1000 triple-axle gear geometry');
  assert.equal(sourceNames.filter(name=>name.startsWith('Added cabin pane ')).length,22,'A350-1000 cabin barrel panes missing');
 }
 if(key==='a339'){
  const engines=doc.nodes.filter(node=>node.extras?.sourceModel==='Original Trent 7000 exterior');
  assert(engines.length>60,'Authored Trent 7000 exterior is missing');
  assert(!doc.nodes.some(node=>node.extras?.sourceModel==='Models/Trent1000.xml'),'A borrowed Trent 1000 component remains');
  assert.equal(sourceNames.filter(name=>/Trent 7000 rolled inlet lip$/.test(name)).length,2,'Both integral nacelle inlet lips are required');
  assert.equal(sourceNames.filter(name=>/Trent 7000 smooth reverser sleeve/.test(name)).length,4,'Missing separate smooth translating sleeves');
  assert.equal(rig.variantConstruction.trent7000Exterior.frontDistanceFromNose,21.05,'Incorrect A330-900 nacelle longitudinal datum');
  assert(doc.nodes.some(node=>node.extras?.sourceName==='cylinder'&&node.extras.sourceModel==='Models/A330-343-main.xml'),'A330 nose shell was removed with a similarly named engine part');
 }
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
 if(key==='b763'){
  let skin;
  loaded.scene.traverse(o=>{if(o.userData.sourceName==='Fuselage'&&o.userData.sourceModel==='Models/767-300.xml')skin=o;});
  assert(skin,'Missing 767 fuselage skin');
  const section=new Box3().setFromObject(skin).getSize(new Vector3());
  assert(Math.abs(section.z-5.03)<.02,'767 fuselage was narrowed by wing-span calibration');
  assert(Math.abs(section.y-5.41)<.02,'767 fuselage vertical section differs from Boeing drawing');
  assert.equal(rig.referenceDimensions.span,50.9,'Winglet-equipped 767 uses the baseline span');
  assert(doc.materials.filter(m=>m.extras?.cockpitGlazing).every(m=>!m.extras?.cabinWindow),'767 cockpit responds to cabin lighting');
 }
 if(rig.sectionReference){
  let skin;
  loaded.scene.traverse(o=>{if(o.userData.sourceName==='Fuselage pressure shell')skin=o;});
  assert(skin,'Authored pressure shell missing');
  const width=new Box3().setFromObject(skin).getSize(new Vector3()).z;
  assert(Math.abs(width-rig.sectionReference.width)<.015,'Fuselage section width differs from the recorded section reference');
 }
 const mixer=new AnimationMixer(loaded.scene);
 const snapshot=()=>{const out=[];loaded.scene.traverse(o=>{if(o.isMesh)out.push(...o.matrix.elements);});return out;};
 let noseWheelRetractionRise=null;
 if(rig.category!=='helicopter'){
 const candidates=[];loaded.scene.traverse(o=>{if(!o.isMesh||(!/wheel|tire|tyre|pneu|roue/i.test(o.userData.sourceName||'')&&o.userData.sourceName!==rig.noseWheelPartName))return;
  if(!rig.motions.some(m=>m.control==='gear'&&matchesMotion(m,o.userData)))return;
  const center=new Box3().setFromObject(o).getCenter(new Vector3());if(center.x<rig.bounds.min[0]+dimensions.length*.4)candidates.push({o,center});
 });
 candidates.sort((a,b)=>a.center.y-b.center.y);const wheel=candidates[0]?.o;assert(wheel,'No driven nose wheel mesh: '+key);

 const gear=mixer.clipAction(loaded.animations.find(a=>a.name==='Gear'));gear.setLoop(LoopOnce,1);gear.clampWhenFinished=true;gear.play();
 mixer.setTime(.02);const up=new Box3().setFromObject(wheel).getCenter(new Vector3());
 mixer.setTime(1);const down=new Box3().setFromObject(wheel).getCenter(new Vector3());
 noseWheelRetractionRise=up.y-down.y;
 assert(noseWheelRetractionRise>.5,'Native Gear clip does not retract wheel upward');// Repeated cycles and interrupted reversals must return every channel to exactly
 // the same endpoint; this catches accumulated transforms and stale parts.
 mixer.setTime(0);loaded.scene.updateMatrixWorld(true);
 const originalUp=snapshot();
 for(const t of [1,.3,.81,.1,1,0,.67,.22,1,0,1,0])mixer.setTime(t);
 assert.deepEqual(snapshot(),originalUp,'Gear cycle left stale transforms');
 if(key==='a320neo'){assert.equal(wheel.scale.x,0,'Enclosed gear hardware remains at fully stowed endpoint');assert(rig.gearInternalParts.length>35);}
 }else{
  assert(!rig.motions.some(m=>m.control==='gear'),'Skid-equipped helicopter has an invented gear mechanism');
  assert(rig.motions.some(m=>m.control==='fans'),'Helicopter rotor control is missing');
 }
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
 }else if(key==='a320neo'){
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
 loaded.scene.traverse(o=>{if(!o.isMesh)return;const assoc=loaded.parser.associations.get(o)||{},ix=assoc.meshes??doc.nodes[assoc.nodes]?.mesh;
  if(ix!==undefined)o.material=materialCopies[doc.meshes[ix].primitives[assoc.primitives||0].material];
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
 if(!rig.cargo)assert(illuminated.length>=1,'Cabin emission is not wired');
 const mainCabinBox=new Box3(),mainCabinNodes=[];let maskedCabinMaterials=0;
 loaded.scene.traverse(o=>{if(!o.isMesh||o.userData.cabinDoorWindow)return;const name=o.userData.sourceName||'';
  if(/nav|lamp|beacon|strobe|landing|taxi|light/i.test(name))return;
  const cabin=[o.material].flat().filter(m=>m?.userData.cabinWindow);if(!cabin.length)return;
  if(cabin.some(m=>m.emissiveMap))maskedCabinMaterials++;
  else {mainCabinNodes.push(name);mainCabinBox.expandByObject(o);}
 });
 const mainCabinSpan=mainCabinBox.isEmpty()?0:mainCabinBox.max.x-mainCabinBox.min.x;
 if(rig.minimumCabinWindowMeshes)assert(mainCabinNodes.length>=rig.minimumCabinWindowMeshes,'Too few modeled passenger panes illuminate');
 if(!rig.cargo&&!['b748f'].includes(key))assert(maskedCabinMaterials>0||mainCabinSpan>dimensions.length*(rig.minimumCabinSpanRatio??.45),'Passenger cabin illumination covers only doors or isolated fixtures');

 runtime.setState({cabin:true});assert(illuminated.every(m=>m.emissiveIntensity>0),'Door/cabin lights failed to turn on');
 runtime.setState({cabin:false});assert(illuminated.every(m=>m.emissiveIntensity===0),'Door/cabin lights failed to turn off');
 runtime.dispose();
 const row={aircraft:key,livery:file.replace('.glb',''),sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length,meshes:doc.meshes.length,animations:doc.animations.map(a=>a.name),dimensions,reference:rig.referenceDimensions,noseWheelRetractionRise,runtimeGearCycles:rig.category==='helicopter'?0:12,cabinMaterials:illuminated.length,mainCabinSpan,maskedCabinMaterials,cockpitTint:'opaque smoke',errors:0,warnings:0};summary.push(row);console.log(JSON.stringify(row));
 } catch(error) { const row={aircraft:key,livery:file.replace('.glb',''),status:'failed',error:error.message};summary.push(row);console.error(JSON.stringify(row)); }
}
if(selected)assert.equal(summary.length,selected.size,'A selected SFO export is missing');
let previous=[];if(requested.size||selected){try{previous=JSON.parse(await readFile(new URL('fleet-validation-summary.json',base),'utf8')).filter(r=>!shouldCheck(r.aircraft,r.livery));}catch{}}
await writeFile(new URL('fleet-validation-summary.json',base),JSON.stringify([...previous,...summary],null,2));
if(summary.some(row=>row.status==='failed'))process.exitCode=1;
