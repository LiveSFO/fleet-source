import {Resvg} from '@resvg/resvg-js';
import {readFile,writeFile,readdir} from 'node:fs/promises';
const folder=new URL('../assets/airliners/preparation/brand-art/',import.meta.url);
for(const name of (await readdir(folder)).filter(n=>n.endsWith('.svg'))){const svg=await readFile(new URL(name,folder),'utf8');const png=new Resvg(svg,{fitTo:{mode:'width',value:2048}}).render().asPng();await writeFile(new URL(name.replace('.svg','.png'),folder),png);console.log(name);}
