import fs from 'node:fs/promises';
const html=await fs.readFile('worker/ui.html','utf8');
await fs.mkdir('dist/server',{recursive:true});
await fs.mkdir('dist/.openai',{recursive:true});
await fs.copyFile('.openai/hosting.json','dist/.openai/hosting.json');
const worker=await fs.readFile('worker/index.js','utf8');
await fs.writeFile('dist/server/index.js',worker.replace("import { html } from './ui.js';",'const html = '+JSON.stringify(html)+';'));

