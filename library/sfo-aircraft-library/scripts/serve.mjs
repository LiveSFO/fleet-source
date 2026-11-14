import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');let rel=decodeURIComponent(url.pathname);if(rel==='/')rel='/viewer/index.html';
  const file=path.resolve(root,'.'+rel);
  if(!file.startsWith(root+path.sep)||rel.split('/').some(v=>v.startsWith('.'))){res.writeHead(403);return res.end('Forbidden');}
  if(!(await stat(file)).isFile())throw Error('not a file');
  const data=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);
 }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.PORT||8080),'127.0.0.1',()=>console.log('Prop workshop: http://127.0.0.1:'+server.address().port));
