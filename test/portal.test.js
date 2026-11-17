import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';

test('autenticación, lectura protegida y revisión compartida', async () => {
  const id='orestias-agassii', point='a'.repeat(20);
  const db=new Map([
    ['data/index',{value:'[{"id":"'+id+'"}]',etag:'index'}],
    ['data/'+id,{value:JSON.stringify({species:{id},points:[{id:point}],areas:[]}),etag:'species'}],
  ]);
  const BUCKET={
    async get(key){const item=db.get(key);return item&&{etag:item.etag,body:item.value,json:()=>JSON.parse(item.value)};},
    async put(key,value,{onlyIf}={}){
      const prior=db.get(key);
      if(onlyIf?.etagMatches&&prior?.etag!==onlyIf.etagMatches || onlyIf?.etagDoesNotMatch==='*'&&prior)return null;
      const item={value,etag:crypto.randomUUID()};db.set(key,item);return item;
    },
  };
  const env={BUCKET,PORTAL_USER:'user-test',PORTAL_PASSWORD:'password-test',SESSION_SECRET:'test-only'};
  const go=(path,opts)=>worker.fetch(new Request('https://test.invalid'+path,opts),env);
  assert.equal((await go('/api/catalog')).status,401);
  assert.equal((await go('/api/species/'+id)).status,401);
  const bad=await go('/api/login',{method:'POST',body:'{"user":"user-test","password":"wrong"}'});
  assert.equal(bad.status,401);
  const auth=await go('/api/login',{method:'POST',body:'{"user":"user-test","password":"password-test"}'});
  assert.equal(auth.status,200);
  const cookie=auth.headers.get('set-cookie').split(';')[0];
  const headers={cookie};
  assert.deepEqual(await (await go('/api/catalog',{headers})).json(),[{id}]);
  const body={ids:[point],action:'exclude',reason:'Duplicado en la fuente',reviewer:'Revisión de prueba'};
  const route='/api/species/'+id;
  assert.equal((await go(route+'/review',{method:'POST',headers:{...headers,origin:'https://other.invalid'},body:JSON.stringify(body)})).status,403);
  const result=await go(route+'/review',{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal(result.status,200);
  assert.equal((await (await go(route,{headers})).json()).review.points[point].excluded,true);
  const restored=await go(route+'/review',{method:'POST',headers,body:JSON.stringify({...body,action:'restore'})});
  assert.equal(restored.status,200,await restored.text());
  const review=(await (await go(route,{headers})).json()).review;
  assert.equal(review.points[point].excluded,false);
  assert.equal(review.history.length,2);
});



