import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowedBasemapAsset,sanitizeBasemapStyle,serveBasemap} from '../worker/basemaps.js';
import worker from '../dist/server/index.js';
const service='https://basemaps-api.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer';
const sprite='https://cdn.arcgis.com/sharing/rest/content/items/3d1a30626bbc46c582f148b9252676ce/resources/sprites/sprite';
const key='fake-test-secret';
test('fetch nativo conserva el receptor global requerido por Workers',async()=>{
  const native=globalThis.fetch;
  try{
    globalThis.fetch=function(){assert.equal(this,globalThis);return Promise.resolve(new Response(new Uint8Array([1]),{headers:{'content-type':'image/png'}}));};
    const response=await serveBasemap(new Request('https://receiver.invalid/api/basemaps/asset?u='+encodeURIComponent(service+'/tile/1/0/0.pbf')),{ARCGIS_LOCATION_API_KEY:key});
    assert.equal(response.status,200);
  }finally{globalThis.fetch=native;}
});
function style(){return {version:8,metadata:{token:key},sources:{esri:{type:'vector',tiles:[service+'/tile/{z}/{y}/{x}.pbf?token='+key],attribution:'Esri'}},glyphs:service+'/resources/fonts/{fontstack}/{range}.pbf?token='+key,sprite:sprite+'?token='+key,layers:[]};}
test('estilos eliminan credenciales y conservan plantillas de teselas, fuentes y sprites',()=>{
  const output=sanitizeBasemapStyle(style(),'https://portal.invalid',key);
  assert.equal(JSON.stringify(output).includes(key),false);
  assert.match(output.style.sources.esri.tiles[0],/^https:\/\/portal.invalid\/api\/basemaps\/asset\?u=/);
  assert.match(output.style.sources.esri.tiles[0],/\{z\}.*\{y\}.*\{x\}/);
  assert.match(output.style.glyphs,/\{fontstack\}.*\{range\}/);
  assert.match(output.style.sprite,/\/sprite\?u=/);
  assert.equal(output.style.sources.esri.maxzoom,16);
  assert.equal(output.credits,'Esri');
});
test('proxy limita servicios y rechaza destinos externos y coordenadas inválidas',async()=>{
  for(const url of ['http://localhost/','https://evil.invalid/'+service,service+'/query',service+'/resources/fonts/%ZZ/0-255.pbf'])assert.equal(allowedBasemapAsset(url),false);
  const env={ARCGIS_LOCATION_API_KEY:key,BASEMAP_FETCH:()=>{throw Error('must not fetch');}};
  const get=u=>serveBasemap(new Request('https://portal.invalid/api/basemaps/asset?u='+encodeURIComponent(u)),env);
  assert.equal((await get('https://127.0.0.1/private')).status,400);
  assert.equal((await get(service+'/tile/1/4/0.pbf')).status,400);
});
test('teselas y sprites se sirven sin exponer clave; errores de ArcGIS no cierran sesión',async()=>{
  let called;
  const env={ARCGIS_LOCATION_API_KEY:key,BASEMAP_FETCH:async(url)=>{called=new URL(url);return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});}};
  const asset=await serveBasemap(new Request('https://portal.invalid/api/basemaps/asset?u='+encodeURIComponent(service+'/tile/1/0/0.pbf')),env);
  assert.equal(asset.status,200);assert.equal(called.searchParams.get('token'),key);
  const response=await serveBasemap(new Request('https://portal.invalid/api/basemaps/sprite@2x.png?u='+encodeURIComponent(sprite)),env);
  assert.equal(response.status,200);assert.equal(called.pathname.endsWith('sprite@2x.png'),true);assert.equal(called.searchParams.has('token'),false);
  env.BASEMAP_FETCH=async()=>Response.json({error:{code:498,message:'Invalid token'}});
  assert.equal((await serveBasemap(new Request('https://portal.invalid/api/basemaps/style/dark'),env)).status,502);
});
test('mapas protegidos aceptan sesión de Pages y CORS, sin publicar la clave',async()=>{
  const env={PORTAL_USER:'test',PORTAL_PASSWORD:'test-password',SESSION_SECRET:'basemap-test',ARCGIS_LOCATION_API_KEY:key,BASEMAP_FETCH:async()=>Response.json(style())};
  const origin='https://ctemplar-zz.github.io';
  const go=(path,options)=>worker.fetch(new Request('https://basemap-auth.invalid'+path,options),env);
  const path='/api/basemaps/style/satellite';
  assert.equal((await go(path)).status,401);
  const preflight=await go(path,{method:'OPTIONS',headers:{origin,'access-control-request-method':'GET','access-control-request-headers':'authorization'}});
  assert.equal(preflight.status,204);
  const login=await go('/api/login',{method:'POST',headers:{origin},body:JSON.stringify({user:'test',password:'test-password'})});
  const {token}=await login.json();
  const response=await go(path,{headers:{origin,authorization:'Bearer '+token}});
  assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),origin);
  assert.equal((await response.text()).includes(key),false);
});
