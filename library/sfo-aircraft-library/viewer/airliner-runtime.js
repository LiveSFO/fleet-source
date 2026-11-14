import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

import {fleetCatalog} from './fleet-catalog.js';
export const aircraftCatalog={
 ...fleetCatalog,
 a320neo:{name:'Airbus A320neo',liveries:[['british-airways','British Airways · G-TTNR'],['sas','SAS · SE-ROJ'],['lufthansa','Lufthansa · D-AINK']]},
 b738:{name:'Boeing 737-800',liveries:[['ryanair','Ryanair'],['southwest','Southwest · Heart'],['american','American Airlines'],['united','United · Continental globe era'],['alaska','Alaska Airlines'],['delta','Delta Air Lines']]},
};
const clamp=THREE.MathUtils.clamp;
function interpolate(points,value){
 if(value<=points[0][0])return points[0][1];
 for(let i=1;i<points.length;i++)if(value<=points[i][0]){
  const [x0,y0]=points[i-1],[x1,y1]=points[i];return THREE.MathUtils.lerp(y0,y1,(value-x0)/(x1-x0));
 }
 return points.at(-1)[1];
}
export function matchesMotion(m,data){return m.targetPartIds?m.targetPartIds.includes(data.sourcePartId):m.model===data.sourceModel&&m.targets.includes(data.sourceName);}
export function motionValue(m,state,time){
 let v=state[m.control]||0;
 if(m.control==='gear'&&m.property.includes('hydraulic/gear/door-'))v=Math.pow(Math.max(0,Math.sin(Math.PI*state.gear)),.65);
 if(m.control==='slats')v=Math.min(1,(state.flaps||0)*2.5);
 if(m.control==='spoilers'&&m.property.includes('final-deg'))v*=35;
 if(m.type==='spin')return time*(state.engineSpeed||0)*480*(m.spinDirection||1);
 v*=m.inputScale||1;
 let value=m.interpolation.length?interpolate(m.interpolation,v):v;
 value=value*m.factor+m.offset;
 if(m.min!==null)value=Math.max(+m.min,value);
 if(m.max!==null)value=Math.min(+m.max,value);
 return value;
}
// Hide enclosed hardware only at the last 0.5% of travel. Door meshes stay visible.
export function gearInternalScale(gear){return clamp(gear/.005,0,1);}
export function motionMatrix(m,value){
 const axis=new THREE.Vector3(...m.axis).normalize();
 if(axis.lengthSq()<.1)return new THREE.Matrix4();
 if(m.type==='translate')return new THREE.Matrix4().makeTranslation(axis.multiplyScalar(value));
 const r=new THREE.Matrix4().makeRotationAxis(axis,THREE.MathUtils.degToRad(value)),c=new THREE.Vector3(...m.center);
 const offset=c.clone().sub(c.clone().applyMatrix4(r));r.setPosition(offset);return r;
}

/** Meters. X aft, Y up, Z port. Call update(seconds, deltaSeconds) per frame. */
export async function loadAirliner({aircraft='a320neo',livery='british-airways',baseURL='/assets/airliners/'}={}){
 const prefix=baseURL+aircraft+'/';
 const [{scene:model},rig,lightSpecs]=await Promise.all([
  new GLTFLoader().loadAsync(prefix+'exports/'+livery+'.glb'),
  fetch(prefix+'exports/'+livery+'.rig.json').then(r=>{if(!r.ok)throw Error('Missing aircraft rig');return r.json();}),
  fetch(prefix+'lights.json').then(r=>r.json()),
 ]);
 const root=new THREE.Group();root.name=aircraft+'_'+livery;root.add(model);
 const state={gear:1,flaps:0,reversers:0,spoilers:0,engineSpeed:.15,cabin:false,navigation:true,beacon:true,strobe:false,landing:false,taxi:false,logo:false,wing:false};
 const target={...state},rigged=[],cabinMaterials=new Set(),materials=new Set();let triangles=0;
 let windowTexture=null;
 if(aircraft==='a320neo'){
  model.traverse(n=>{for(const m of [n.material].flat())if(m?.name.includes('fuselage_')&&m.emissiveMap)windowTexture=m.emissiveMap;});
  if(!windowTexture){windowTexture=await new THREE.TextureLoader().loadAsync(prefix+'generated/cabin-window-emission.png');windowTexture.flipY=false;}
  windowTexture.colorSpace=THREE.NoColorSpace;
 }
 model.traverse(node=>{
  if(!node.isMesh)return;
  triangles+=(node.geometry.index?.count||node.geometry.attributes.position.count)/3;
  node.castShadow=node.receiveShadow=true;
  const name=node.userData.sourceName||'';
  if(name.includes('FanSpinning')||name==='Rat'||name==='RatSpinner')node.visible=false;
  node.material=[node.material].flat().map(original=>{
   // A model instance owns its materials; livery/state changes are isolated.
   const m=original;materials.add(m);
   if(m.map)m.map.anisotropy=8;
   if(aircraft==='a320neo'&&m.name.includes('fuselage_')){
    m.emissiveMap=windowTexture;m.emissive.setRGB(1,.69,.36);cabinMaterials.add(m);
   }else if(m.userData.cabinWindow||(aircraft==='b738'&&name==='rearwindows.ext')){
    m.emissive.setRGB(1,.69,.36);cabinMaterials.add(m);m.transparent=false;m.opacity=1;
   }
   return m;
  });
  if(node.material.length===1)node.material=node.material[0];
  const motions=rig.motions.filter(m=>matchesMotion(m,node.userData));
  const internal=rig.gearInternalPartIds?rig.gearInternalPartIds.includes(node.userData.sourcePartId):rig.gearInternalParts?.includes(name)||false;
  if(motions.length||internal){node.frustumCulled=false;node.updateMatrix();rigged.push({node,base:node.matrix.clone(),motions,internal});node.matrixAutoUpdate=false;}
 });
 const lightGroup=new THREE.Group();root.add(lightGroup);const lights=[];
 const bulbGeometry=new THREE.SphereGeometry(.065,12,8);
 // Each light includes a luminous fixture and a modest local light. Directional
 // landing/taxi spots are aimed forwards/downwards in aircraft coordinates.
 for(const spec of lightSpecs){
  const color=spec.color==='red'?0xff1709:spec.color==='green'?0x00ff73:0xe8f3ff;
  const material=new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(12),toneMapped:false});
  const fixture=new THREE.Mesh(bulbGeometry,material);fixture.position.fromArray(spec.position);lightGroup.add(fixture);
  const spotKind=['landing','taxi','turnoff','winglight','logo'].includes(spec.kind);
  const light=spotKind?new THREE.SpotLight(color,0,130,spec.kind==='logo'?.55:spec.kind==='winglight'?.4:.14,.65,2):new THREE.PointLight(color,0,4,2);
  light.position.copy(fixture.position);lightGroup.add(light);
  if(spotKind){
   const dir=spec.kind==='winglight'?new THREE.Vector3(2,0,spec.position[2]>0?6:-6):new THREE.Vector3(-35,-4,spec.kind==='turnoff'?(spec.position[2]>0?12:-12):0);
   if(spec.target)light.target.position.fromArray(spec.target);else light.target.position.copy(light.position).add(dir);lightGroup.add(light.target);
  }
  lights.push({spec,fixture,light});
 }
 const bounds=new THREE.Box3().setFromObject(model);root.position.set(-(bounds.min.x+bounds.max.x)/2,-bounds.min.y,0);
 function apply(time=0){
  for(const {node,base,motions,internal} of rigged){
   const transform=new THREE.Matrix4();
   for(const m of motions)transform.multiply(motionMatrix(m,motionValue(m,state,time)));
   if(internal)transform.multiply(new THREE.Matrix4().makeScale(...Array(3).fill(gearInternalScale(state.gear))));
   node.matrix.copy(transform).multiply(base);node.matrixWorldNeedsUpdate=true;
  }
  for(const material of cabinMaterials)material.emissiveIntensity=state.cabin?2.1:0;
  const cycle=((time%1.12)+1.12)%1.12;
  for(const {spec,fixture,light} of lights){
   let enabled=spec.kind==='nav'?state.navigation:spec.kind==='winglight'?state.wing:spec.kind==='turnoff'?state.taxi:state[spec.kind];
   if(spec.kind==='beacon')enabled&&=cycle<.07||(cycle>.14&&cycle<.20);
   if(spec.kind==='strobe')enabled&&=cycle<.045||(aircraft==='a320neo'&&cycle>.11&&cycle<.155);
   if(spec.kind==='taxi'||spec.kind==='turnoff')enabled&&=state.gear>.95;
   fixture.visible=!!enabled;light.intensity=enabled?(['landing','taxi','turnoff'].includes(spec.kind)?2500:spec.kind==='winglight'?120:spec.kind==='logo'?20:4):0;
  }
 }
 const api={root,model,rig,state,target,lights,triangles,
  setState(values,{instant=false}={}){
   for(const [key,v] of Object.entries(values))if(key in state){
    target[key]=typeof state[key]==='boolean'?Boolean(v):clamp(Number.isFinite(v)?v:0,0,1);
    if(instant||typeof state[key]==='boolean')state[key]=target[key];
   }
   apply();return api;
  },
  update(time,dt=1/60){
   for(const key of ['gear','flaps','reversers','spoilers','engineSpeed']){
    const step=dt/(key==='gear'?5:key==='flaps'?7:key==='reversers'?2:1);
    state[key]+=clamp(target[key]-state[key],-step,step);
   }
   apply(time);
  },
  dispose(){
   root.removeFromParent();const geometries=new Set(),textures=new Set();
   model.traverse(n=>{if(n.geometry)geometries.add(n.geometry);});
   for(const m of materials){for(const v of Object.values(m))if(v?.isTexture)textures.add(v);m.dispose();}
   for(const g of geometries)g.dispose();for(const t of textures)t.dispose();
   bulbGeometry.dispose();for(const x of lights)x.fixture.material.dispose();
  },
 };
 apply();return api;
}
