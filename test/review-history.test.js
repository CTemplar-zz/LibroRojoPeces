import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';

function fixture(seed) {
  const db=new Map(Object.entries(seed).map(([key,value])=>[key,{value:JSON.stringify(value),etag:crypto.randomUUID()}]));
  const env={PORTAL_USER:'test',PORTAL_PASSWORD:'test-password',SESSION_SECRET:'history-test',BUCKET:{
    async get(key){const item=db.get(key);return item&&{etag:item.etag,body:item.value,json:()=>JSON.parse(item.value)};},
    async list({prefix,cursor}){
      const keys=[...db.keys()].filter(key=>key.startsWith(prefix)).sort();
      const start=Number(cursor||0),page=keys.slice(start,start+1);
      return {objects:page.map(key=>({key})),truncated:start+1<keys.length,cursor:String(start+1)};
    },
    async put(key,value,{onlyIf}={}){
      const prior=db.get(key);
      if(onlyIf?.etagMatches&&prior?.etag!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&prior)return null;
      const item={value,etag:crypto.randomUUID()};db.set(key,item);return item;
    },
  }};
  const go=(path,opts)=>worker.fetch(new Request('https://test.invalid'+path,opts),env);
  return {db,go};
}

test('historial general protegido, paginado y compatible con revisiones anteriores',async()=>{
  const first='orestias-agassii',second='moema-juanderibaensis';
  const points=Array.from({length:52},(_,i)=>({id:i.toString(16).padStart(20,'0'),x:-68-i/100,y:-16,source:'GBIF',url:'https://www.gbif.org/occurrence/'+i}));
  const history=points.map(p=>({id:'event-'+p.id,ids:[p.id],at:'2026-11-19T12:00:00.000Z',action:'exclude',reviewer:'Experto',reason:'Ubicación por revisar'}));
  const {go}=fixture({
    ['data/'+first]:{species:{id:first,name:'Orestias agassii'},points},
    ['data/'+second]:{species:{id:second,name:'Moema juanderibaensis'},points:[points[0]]},
    ['reviews/'+first]:{points:{[points[0].id]:{excluded:false},[points[1].id]:{excluded:true}},history},
    ['reviews/'+second]:{points:{},history:[{...history[0],id:'restored',action:'restore'}]},
  });
  assert.equal((await go('/api/reviews')).status,401);
  const auth=await go('/api/login',{method:'POST',body:JSON.stringify({user:'test',password:'test-password'}),headers:{origin:'https://ctemplar-zz.github.io'}});
  const {token}=await auth.json();
  const headers={origin:'https://ctemplar-zz.github.io',authorization:'Bearer '+token};
  const response=await go('/api/reviews',{headers});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('access-control-allow-origin'),headers.origin);
  const page=await response.json();
  assert.equal(page.total,52);
  assert.equal(page.items.length,50);
  assert.ok(page.next);
  assert.equal(page.items[0].speciesName,'Orestias agassii');
  assert.deepEqual(page.items[0].coordinate,{x:points[51].x,y:-16});
  const last=await (await go('/api/reviews?cursor='+encodeURIComponent(page.next),{headers})).json();
  assert.equal(last.items.length,2);
  assert.equal(last.next,null);
  assert.equal(new Set([...page.items,...last.items].map(e=>e.eventId+e.pointId)).size,52);
  assert.equal(last.items.find(e=>e.pointId===points[0].id).excluded,false);
  assert.equal(last.items.find(e=>e.pointId===points[1].id).excluded,true);
  const restored=await (await go('/api/reviews?action=all&species='+second,{headers})).json();
  assert.equal(restored.total,1);
  assert.equal(restored.items[0].action,'restore');
  assert.equal((await (await go('/api/reviews?species='+second,{headers})).json()).total,0);
  for(const query of ['action=purge','species=../data','cursor=invalid','cursor='+btoa('[1,2,3]')])assert.equal((await go('/api/reviews?'+query,{headers})).status,400);
});

test('nuevas exclusiones conservan coordenadas, fuente y URL después de restaurar',async()=>{
  const id='orestias-agassii',point={id:'a'.repeat(20),x:-68.2,y:-16.1,source:'ICTIO',url:'https://example.org/registro'};
  const {go,db}=fixture({['data/'+id]:{species:{id,name:'Orestias agassii'},points:[point]}});
  const auth=await go('/api/login',{method:'POST',body:JSON.stringify({user:'test',password:'test-password'})});
  const headers={cookie:auth.headers.get('set-cookie').split(';')[0]};
  for(const action of ['exclude','restore']){
    const response=await go('/api/species/'+id+'/review',{method:'POST',headers,body:JSON.stringify({ids:[point.id],action,reviewer:'Experto',reason:'Verificación de coordenadas'})});
    assert.equal(response.status,200);
  }
  // A later data update must not change the location recorded for the review.
  db.set('data/'+id,{etag:'updated',value:JSON.stringify({species:{id,name:'Orestias agassii'},points:[{...point,x:-65,y:-12}]})});
  const {items,total}=await (await go('/api/reviews',{headers})).json();
  assert.equal(total,1);
  assert.deepEqual(items[0].coordinate,{x:point.x,y:point.y});
  assert.equal(items[0].source,point.source);
  assert.equal(items[0].url,point.url);
  assert.equal(items[0].excluded,false);
  const data=await (await go('/api/species/'+id,{headers})).json();
  assert.equal(data.points.length,1);
  assert.equal(data.review.history.length,2);
  assert.deepEqual(data.review.history[0].points,[point]);
});
