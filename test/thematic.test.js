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

test('importación de minería con secreto, geometrías válidas y cierre tras publicar',async()=>{
  const data=new Map();
  const BUCKET={
    async head(key){return data.has(key)?{size:data.get(key).length}:null;},
    async get(key){return data.has(key)?{body:data.get(key)}:null;},
    async put(key,value,{onlyIf}={}){if(onlyIf?.etagDoesNotMatch==='*'&&data.has(key))return null;data.set(key,value);return {etag:'mining'};},
  };
  const env={BUCKET,MINING_IMPORT_TOKEN:'test-import',SESSION_SECRET:'secret-test',PORTAL_USER:'user-test',PORTAL_PASSWORD:'password-test'};
  const go=(path,opts)=>worker.fetch(new Request('https://test.invalid'+path,opts),env);
  const feature={type:'Feature',properties:{id:0,ANIO:2025,MINED_HA:10.54,PERIODO:'Q3',nombre_ap:'Madidi'},geometry:{type:'Polygon',coordinates:[[[-68,-14],[-67.99,-14],[-68,-13.99],[-68,-14]]]}};
  const layer={type:'FeatureCollection',features:[feature]};
  const upload=(value,authorization='Bearer test-import')=>go('/api/import-mining',{method:'PUT',headers:{authorization},body:JSON.stringify(value)});
  assert.equal((await upload(layer,'Bearer incorrect')).status,401);
  assert.equal((await go('/api/thematic/mining')).status,401);
  const invalid=structuredClone(layer);invalid.features[0].geometry.coordinates[0][0][0]=300;
  assert.equal((await upload(invalid)).status,400);
  assert.equal((await upload({...layer,features:[]})).status,400);
  const imported=await upload(layer);
  assert.equal(imported.status,200);
  assert.deepEqual(await imported.json(),{stored:true,features:1});
  assert.equal((await upload(layer)).status,409);
  const origin='https://ctemplar-zz.github.io';
  const login=await go('/api/login',{method:'POST',headers:{origin},body:JSON.stringify({user:'user-test',password:'password-test'})});
  const {token}=await login.json();
  const response=await go('/api/thematic/mining',{headers:{origin,authorization:'Bearer '+token}});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('access-control-allow-origin'),origin);
  assert.deepEqual(await response.json(),layer);
  assert.equal((await go('/api/import-mining',{method:'OPTIONS',headers:{origin,'access-control-request-method':'PUT'}})).status,404);
  assert.equal(data.size,1);
  assert.ok(data.has('thematic/20261120/mining'));
});

