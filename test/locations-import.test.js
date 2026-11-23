import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';

function setup(){
  const id='orestias-agassii',point={id:'a'.repeat(20),x:-68.2,y:-16.1,source:'ICTIO',flags:[]};
  const db=new Map(),put=(key,value)=>db.set(key,{value:JSON.stringify(value),etag:crypto.randomUUID()});
  put('data/index',[{id,name:'Orestias agassii',count:1}]);put('data/'+id,{species:{id,name:'Orestias agassii',count:1},points:[point],areas:[]});
  let onPut=null;
  const env={PORTAL_USER:'test',PORTAL_PASSWORD:'test-password',SESSION_SECRET:'location-test',SUPPLEMENT_IMPORT_TOKEN:'import-test',BUCKET:{
    async head(key){return db.has(key)?{etag:db.get(key).etag}:null;},
    async get(key){const item=db.get(key);return item&&{etag:item.etag,body:item.value,json:()=>JSON.parse(item.value)};},
    async list({prefix}){return {objects:[...db.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false};},
    async put(key,value,{onlyIf}={}){
      if(onPut){const hook=onPut;onPut=null;hook(key);}
      const prior=db.get(key);
      if(onlyIf?.etagMatches&&prior?.etag!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&prior)return null;
      const item={value,etag:crypto.randomUUID()};db.set(key,item);return item;
    },
  }};
  const go=(path,options)=>worker.fetch(new Request('https://test.invalid'+path,options),env);
  const login=async()=>{const r=await go('/api/login',{method:'POST',headers:{origin:'https://ctemplar-zz.github.io'},body:JSON.stringify({user:'test',password:'test-password'})});const {token}=await r.json();return {origin:'https://ctemplar-zz.github.io',authorization:'Bearer '+token};};
  return {id,point,db,go,login,put,race:hook=>{onPut=hook;}};
}

test('carga suplementaria atómica, identificadores conservados y revisiones aplicables a registros nuevos',async()=>{
  const {go,id,point,db,login}=setup(),headers=await login();
  const second={...point,id:'b'.repeat(20),source:'Peces final'};
  const upload=(key,body,token='import-test')=>go('/api/import-supplement/'+key,{method:'PUT',headers:{authorization:'Bearer '+token},body:JSON.stringify(body)});
  const manifest={species:{[id]:1},total:1};
  assert.equal((await upload(id,{species:id,points:[second]},'wrong')).status,401);
  assert.equal((await upload('index',manifest)).status,409);
  assert.equal((await upload(id,{species:id,points:[point]})).status,409);
  assert.equal((await upload(id,{species:id,points:[second]})).status,200);
  assert.equal((await upload(id,{species:id,points:[second]})).status,200);
  assert.equal((await (await go('/api/species/'+id,{headers})).json()).points.length,1);
  assert.equal((await upload('index',manifest)).status,200);
  assert.equal((await upload(id,{species:id,points:[second]})).status,409);
  const data=await (await go('/api/species/'+id,{headers})).json();
  assert.equal(data.points.length,2);assert.equal(data.duplicates.candidates,2);
  assert.equal((await (await go('/api/catalog',{headers})).json())[0].count,2);
  const reviewed=await go('/api/species/'+id+'/review',{method:'POST',headers,body:JSON.stringify({ids:[second.id],action:'exclude',reviewer:'Experto',reason:'Duplicado confirmado'})});
  assert.equal(reviewed.status,200);
  assert.equal((await (await go('/api/species/'+id,{headers})).json()).duplicates.candidates,0);
  assert.deepEqual(JSON.parse(db.get('data/'+id).value).points,[point]);
  assert.equal((await go('/api/import-supplement/index',{method:'OPTIONS',headers:{origin:headers.origin,'access-control-request-method':'PUT'}})).status,404);
});

test('movimientos conservan inicial, anterior, exclusiones y controlan ediciones concurrentes',async()=>{
  const {go,id,point,db,login,put,race}=setup(),headers=await login(),route='/api/species/'+id;
  const change={pointId:point.id,x:-68.21,y:-16.11,previousRevision:null,reviewer:'Experto',reason:'Corrección de localización'};
  assert.equal((await go(route+'/location',{method:'POST',body:JSON.stringify(change)})).status,401);
  assert.equal((await go(route+'/location',{method:'POST',headers:{...headers,origin:'https://other.invalid'},body:JSON.stringify(change)})).status,403);
  assert.equal((await go(route+'/location',{method:'POST',headers,body:JSON.stringify({...change,y:100})})).status,400);
  // Another reviewer excludes the point between the read and write of its location.
  race(key=>{assert.equal(key,'reviews/'+id);put(key,{points:{[point.id]:{excluded:true,reviewer:'Otro experto',reason:'Verificar fuente'}},history:[]});});
  const result=await go(route+'/location',{method:'POST',headers,body:JSON.stringify(change)});
  assert.equal(result.status,200);
  const moved=await result.json(),p=moved.points[0];
  assert.equal(p.x,change.x);assert.equal(p.originalX,point.x);assert.ok(p.locationRevision);
  assert.equal(moved.review.points[point.id].excluded,true);
  assert.deepEqual(moved.review.history[0].points[0].previous,{x:point.x,y:point.y});
  assert.equal((await go(route+'/location',{method:'POST',headers,body:JSON.stringify({...change,x:-68.3})})).status,409);
  const restored=await go(route+'/location',{method:'POST',headers,body:JSON.stringify({...change,x:point.x,y:point.y,previousRevision:p.locationRevision})});
  assert.equal(restored.status,200);
  const final=await restored.json();assert.equal(final.points[0].x,point.x);assert.equal(final.review.history.length,2);
  const history=await (await go('/api/reviews?action=move',{headers})).json();
  assert.equal(history.total,2);assert.ok(history.items.every(e=>e.originalCoordinate.x===point.x));
  assert.ok(history.items.some(e=>e.previousCoordinate.x===change.x));
  assert.deepEqual(JSON.parse(db.get('data/'+id).value).points,[point]);
  const excluded=await go(route+'/review',{method:'POST',headers,body:JSON.stringify({ids:[point.id],action:'restore',reviewer:'Experto',reason:'Ubicación verificada'})});
  assert.equal(excluded.status,200);
  assert.ok((await excluded.json()).locations[point.id]);
});
