import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const html=await fs.readFile('worker/ui.html','utf8');
await fs.mkdir('dist/server',{recursive:true});
await fs.mkdir('dist/.openai',{recursive:true});
await fs.copyFile('.openai/hosting.json','dist/.openai/hosting.json');
const worker=await fs.readFile('worker/index.js','utf8');
const proximity=(await fs.readFile('worker/proximity.js','utf8')).replaceAll('export function ','function ');
const basemapCode=(await fs.readFile('worker/basemaps.js','utf8')).replaceAll('export async function ','async function ').replaceAll('export function ','function ');
await fs.writeFile('dist/server/index.js',worker.replace("import { html } from './ui.js';",()=> 'const html = '+JSON.stringify(html)+';').replace("import { classifyDuplicates } from './proximity.js';",()=>proximity).replace("import { serveBasemap } from './basemaps.js';",()=>basemapCode));

if(process.argv.includes('--pages')||process.argv.includes('--check-pages')){
  const portal='https://libro-rojo-peces-bolivia.ctemplar.chatgpt.site';
  const page=html.replace("const apiOrigin='';","const apiOrigin='"+portal+"';").replace(/\r\n/g,'\n');
  const script=page.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash=createHash('sha256').update(script).digest('base64');
  const policy="default-src 'none'; script-src 'sha256-"+hash+"' https://unpkg.com; style-src 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src blob: data: https://unpkg.com https://services.arcgisonline.com "+portal+"; connect-src https://unpkg.com "+portal+"; worker-src blob:; base-uri 'none'; form-action 'none'";
  const output=page.replace('<!-- GitHub Pages security policy -->','<meta http-equiv="Content-Security-Policy" content="'+policy+'">');
  if(process.argv.includes('--check-pages')){
    const current=(await fs.readFile('index.html','utf8')).replace(/\r\n/g,'\n');
    if(current!==output)throw new Error('La entrada de GitHub Pages requiere node scripts/build.mjs --pages');
  }else await fs.writeFile('index.html',output);
}

