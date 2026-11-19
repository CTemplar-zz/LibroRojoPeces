import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';

test('capas temáticas protegidas y lectura de ráster por rangos desde GitHub',async()=>{
  const body=new Uint8Array([73,73,42,0,8,0,0,0]);
  let reads=0;
  const BUCKET={
    async head(key){return key==='thematic/20261119/fire.tif'?{size:body.length}:null;},
    async get(key,{range}={}){
      reads++;
      if(key==='thematic/20261119/fire.tif')return {body:body.slice(range.offset,range.offset+range.length)};
      if(key==='thematic/20261119/basins')return {body:'{"type":"FeatureCollection","features":[]}'};
      return null;
    }
  };
  const env={BUCKET,SESSION_SECRET:'secret-test',PORTAL_USER:'user-test',PORTAL_PASSWORD:'password-test'};
  const origin='https://ctemplar-zz.github.io';
  const go=(path,opts)=>worker.fetch(new Request('https://test.invalid'+path,opts),env);
  const path='/api/thematic/fire.tif';
  assert.equal((await go(path,{headers:{origin,range:'bytes=0-3'}})).status,401);
  assert.equal(reads,0);
  const auth=await go('/api/login',{method:'POST',headers:{origin},body:JSON.stringify({user:'user-test',password:'password-test'})});
  const {token}=await auth.json();
  const headers={origin,authorization:'Bearer '+token};
  const pre=await go(path,{method:'OPTIONS',headers:{origin,'access-control-request-method':'GET','access-control-request-headers':'authorization,range'}});
  assert.equal(pre.status,204);
  const r=await go(path,{headers:{...headers,range:'bytes=0-3'}});
  assert.equal(r.status,206);
  assert.equal(r.headers.get('content-range'),'bytes 0-3/8');
  assert.equal(r.headers.get('access-control-allow-origin'),origin);
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[73,73,42,0]);
  assert.equal((await go(path,{headers:{...headers,range:'bytes=99-100'}})).status,416);
  assert.equal((await go(path,{headers})).status,400);
  const basins=await go('/api/thematic/basins',{headers});
  assert.equal(basins.status,200);
  assert.equal((await basins.json()).type,'FeatureCollection');
});

