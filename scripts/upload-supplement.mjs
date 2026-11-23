import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

// Runtime credentials are supplied through hidden stdin, never command arguments or files.
process.stdout.write('Ready for supplement upload JSON on stdin (input is hidden).\n');
const config=await new Promise((resolve,reject)=>{
  let input='';if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');
  process.stdin.on('data',function receive(chunk){
    input+=chunk;
    if(!/[\r\n]/.test(input))return;
    process.stdin.off('data',receive);if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();
    try{resolve(JSON.parse(input.trim()));}catch{reject(new Error('Invalid hidden configuration'));}
  });
});
const {url,user,password,secret}=config,dir=process.argv[2],backup=process.argv[3],reportPath=process.argv[4],origin='https://ctemplar-zz.github.io';
const read=async path=>JSON.parse(await fs.readFile(path,'utf8'));
const manifest=await read(dir+'/index.json'),before=await read(backup+'/index.json');
const login=await fetch(url+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({user,password})});
if(!login.ok)throw new Error('Login '+login.status);
const {token}=await login.json(),headers={origin,authorization:'Bearer '+token};
const get=async path=>{const r=await fetch(url+path,{headers});if(!r.ok)throw new Error(path+' '+r.status);return r.json();};
const catalog=await get('/api/catalog');
const expectedCount=s=>(s.count||0)+(manifest.species[s.id]||0);
const activated=catalog.length===before.length&&before.every(s=>catalog.find(a=>a.id===s.id)?.count===expectedCount(s));
if(!activated){
  async function upload(key){
    const body=await fs.readFile(dir+'/'+key+'.json');
    const result=await fetch(url+'/api/import-supplement/'+key,{method:'PUT',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body});
    if(!result.ok)throw new Error('Import '+key+' '+result.status+' '+(await result.text()).slice(0,120));
  }
  const queue=Object.keys(manifest.species);let uploaded=0;
  await Promise.all(Array.from({length:3},async()=>{while(queue.length){await upload(queue.shift());uploaded++;if(uploaded%20===0)console.log('Cargadas',uploaded,'especies');}}));
  await upload('index');console.log('Consolidado activado:',manifest.total,'registros');
}
const finalCatalog=await get('/api/catalog');
assert.equal(finalCatalog.length,168);
const queue=[...before],rows=[];let checked=0,preservedEvents=0;
await Promise.all(Array.from({length:3},async()=>{
  while(queue.length){
    const s=queue.shift(),data=await get('/api/species/'+s.id),snapshot=await read(backup+'/'+s.id+'.json');
    const extra=manifest.species[s.id]?(await read(dir+'/'+s.id+'.json')).points:[];
    const points=new Map(data.points.map(p=>[p.id,p]));
    assert.equal(points.size,snapshot.points.length+extra.length);
    assert.equal(finalCatalog.find(a=>a.id===s.id).count,points.size);
    assert.equal(data.species.category,snapshot.species.category);
    assert.deepEqual(data.areas,snapshot.areas);
    for(const prior of snapshot.points){
      const actual=points.get(prior.id);assert.ok(actual,'Existing identifier preserved');
      assert.equal(actual.originalX,prior.originalX??prior.x);assert.equal(actual.originalY,prior.originalY??prior.y);
      for(const key of Object.keys(prior))if(!['x','y','originalX','originalY','possibleDuplicate','duplicateGroup','duplicateNeighbors','nearestDuplicateM','locationRevision','moved'].includes(key))assert.deepEqual(actual[key],prior[key]);
    }
    for(const prior of extra){
      const actual=points.get(prior.id);assert.ok(actual,'Supplement identifier present');
      assert.equal(actual.originalX,prior.x);assert.equal(actual.originalY,prior.y);
      for(const key of Object.keys(prior))if(!['x','y'].includes(key))assert.deepEqual(actual[key],prior[key]);
    }
    const events=new Set(data.review.history.map(e=>e.id));
    for(const e of snapshot.review.history){assert.ok(events.has(e.id),'Existing history preserved');preservedEvents++;}
    assert.ok(data.points.every(p=>typeof p.possibleDuplicate==='boolean'&&Number.isFinite(p.originalX)&&Number.isFinite(p.originalY)));
    rows.push({id:s.id,species:s.name,total:points.size,added:extra.length,candidates:data.duplicates.candidates,groups:data.duplicates.groups});
    checked++;if(checked%30===0)console.log('Verificadas',checked,'especies');
  }
}));
const report={at:new Date().toISOString(),species:rows.length,previous:rows.reduce((n,s)=>n+s.total-s.added,0),added:rows.reduce((n,s)=>n+s.added,0),total:rows.reduce((n,s)=>n+s.total,0),candidates:rows.reduce((n,s)=>n+s.candidates,0),groups:rows.reduce((n,s)=>n+s.groups,0),preservedReviewEvents:preservedEvents,sourceCounts:manifest.sourceCounts,speciesCounts:rows.sort((a,b)=>a.species.localeCompare(b.species))};
assert.equal(report.added,18318);assert.equal(report.total,46826);
assert.equal((await fetch(url+'/api/species/'+before[0].id)).status,401);
if(reportPath)await fs.writeFile(reportPath,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,speciesCounts:undefined}));
