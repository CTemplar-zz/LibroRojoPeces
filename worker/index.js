import { html } from './ui.js';
const enc = new TextEncoder();
const sources = new Set(['ICTIO','AmazFish','iNaturalist','GBIF','AmazonFish v2','FishBase','Literatura']);
const headers = {'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY'};
const json = (data,status=200,extra={})=>Response.json(data,{status,headers:{...headers,...extra}});
const hex = bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
const digest = async s=>hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));
async function safeEqual(a,b) {
  const [x,y]=await Promise.all([digest(a),digest(b)]);
  let result=0;
  for(let i=0;i<x.length;i++)result|=x.charCodeAt(i)^y.charCodeAt(i);
  return result===0;
}
async function sign(s,secret) {
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,enc.encode(s)));
}
const cookieName='libro_rojo';
async function authenticated(request,env) {
  if(!env.SESSION_SECRET)return false;
  const token=request.headers.get('cookie')?.match(/(?:^|;\s*)libro_rojo=(\d+\.[a-f0-9]{32}\.[a-f0-9]{64})(?:;|$)/)?.[1];
  if(!token)return false;
  const [until,nonce,mac]=token.split('.');
  return Number(until)>Date.now()&&await safeEqual(mac,await sign(until+'.'+nonce,env.SESSION_SECRET));
}
function cookie(request,value,maxAge) {
  const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
  return cookieName+'='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge+secure;
}
const speciesId = /^[a-z][a-z-]{2,100}$/;
const pointId = /^[a-f0-9]{20}$/;
const originAllowed = (request,url)=>!request.headers.has('origin') || request.headers.get('origin')===url.origin;
const errors = (message,status)=>json({error:message},status);
async function load(bucket,key) {
  const obj=await bucket.get(key);
  return obj?{etag:obj.etag,value:await obj.json()}:null;
}
const emptyReview=()=>({points:{},history:[]});
async function seed(request,env,key) {
  if(!env.IMPORT_TOKEN || !await safeEqual(request.headers.get('authorization')||'','Bearer '+env.IMPORT_TOKEN))return errors('Acceso restringido',401);
  if(await env.BUCKET.head('data/index'))return errors('La importación ya está cerrada',409);
  const raw=await request.text();
  if(raw.length>8_000_000)return errors('Archivo demasiado grande',413);
  const data=JSON.parse(raw);
  if(key==='index'){
    if(!Array.isArray(data)||data.length!==168||new Set(data.map(s=>s.id)).size!==168||data.some(s=>!speciesId.test(s.id)))return errors('Índice inválido',400);
    const objects=await env.BUCKET.list({prefix:'data/',limit:200});
    if(data.some(s=>!objects.objects.some(o=>o.key==='data/'+s.id)))return errors('Hay especies pendientes de subir',409);
    return json({stored:!!await env.BUCKET.put('data/index',raw,{onlyIf:{etagDoesNotMatch:'*'}})});
  }
  if(data.species?.id!==key||!Array.isArray(data.points)||!Array.isArray(data.areas)||data.points.some(p=>!pointId.test(p.id)||!sources.has(p.source)||!Number.isFinite(p.x)||!Number.isFinite(p.y)))return errors('Datos inválidos',400);
  await env.BUCKET.put('data/'+key,raw);
  return json({stored:true});
}
async function update(request,bucket,id) {
  const {ids,action,reason,reviewer}=await request.json();
  const name=typeof reviewer==='string'?reviewer.trim():'';
  const note=typeof reason==='string'?reason.trim():'';
  if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(s=>typeof s!=='string'||!pointId.test(s))||!['exclude','restore'].includes(action)||name.length<2||name.length>100||note.length<5||note.length>1500)return errors('Indica los registros, tu nombre y el motivo (5 a 1.500 caracteres).',400);
  const data=await load(bucket,'data/'+id);
  if(!data)return errors('Especie inexistente',404);
  const valid=new Set(data.value.points.map(p=>p.id));
  const selected=[...new Set(ids)];
  if(selected.some(p=>!valid.has(p)))return errors('Hay registros de otra especie',400);
  const key='reviews/'+id;
  for(let attempt=0;attempt<5;attempt++){
    const current=await load(bucket,key);
    const review=current?.value||emptyReview();
    const at=new Date().toISOString();
    const event={id:crypto.randomUUID(),ids:selected,action,reviewer:name,reason:note,at};
    for(const p of selected)review.points[p]={excluded:action==='exclude',reviewer:name,reason:note,at};
    review.history.push(event);
    const onlyIf=current?{etagMatches:current.etag}:{etagDoesNotMatch:'*'};
    if(await bucket.put(key,JSON.stringify(review),{onlyIf}))return json(review);
  }
  return errors('Otra persona guardó cambios al mismo tiempo. Intenta de nuevo.',409);
}
const misses = new Map();
export default {async fetch(request,env){
  const url=new URL(request.url);
  const path=url.pathname;
  try {
    if(path==='/'&&request.method==='GET')return new Response(html,{headers:{...headers,'content-type':'text/html; charset=utf-8'}});
    if(path.startsWith('/api/import/')&&request.method==='PUT'){
      const key=path.split('/').at(-1);
      return key==='index'||speciesId.test(key)?await seed(request,env,key):errors('Ruta incorrecta',404);
    }
    if(request.method!=='GET'&&!originAllowed(request,url))return errors('Origen no permitido',403);
    if(path==='/api/login'&&request.method==='POST'){
      if(!env.PORTAL_USER||!env.PORTAL_PASSWORD||!env.SESSION_SECRET)return errors('Acceso sin configurar',503);
      const ip=request.headers.get('CF-Connecting-IP')||'local';
      const now=Date.now();
      if(misses.size>2048)for(const [key,entry] of misses)if(entry.until<=now)misses.delete(key);
      const prior=misses.get(ip);
      if(prior&&prior.until>now&&prior.n>=12)return errors('Demasiados intentos. Vuelve a intentarlo en unos minutos.',429);
      const {user,password}=await request.json();
      if(typeof user!=='string'||typeof password!=='string'||user.length>128||password.length>256)return errors('Credenciales inválidas',401);
      const [userOk,passwordOk]=await Promise.all([safeEqual(user,env.PORTAL_USER),safeEqual(password,env.PORTAL_PASSWORD)]);
      if(!userOk||!passwordOk){misses.set(ip,prior?.until>now?{...prior,n:prior.n+1}:{until:now+600_000,n:1});return errors('Usuario o contraseña incorrectos',401);}
      misses.delete(ip);
      const payload=(now+28_800_000)+'.'+hex(crypto.getRandomValues(new Uint8Array(16)));
      return json({ok:true},200,{'set-cookie':cookie(request,payload+'.'+await sign(payload,env.SESSION_SECRET),28800)});
    }
    if(path==='/api/logout'&&request.method==='POST')return json({ok:true},200,{'set-cookie':cookie(request,'',0)});
    if(!path.startsWith('/api/'))return errors('Ruta no encontrada',404);
    if(!await authenticated(request,env))return errors('Inicia sesión para continuar',401);
    if(path==='/api/catalog'&&request.method==='GET'){
      const obj=await env.BUCKET.get('data/index');
      return obj?new Response(obj.body,{headers:{...headers,'content-type':'application/json; charset=utf-8'}}):errors('El catálogo se está cargando',503);
    }
    const match=path.match(/^\/api\/species\/([a-z][a-z-]{2,100})(\/review)?$/);
    if(match){
      const [,id,review]=match;
      if(review&&request.method==='POST')return await update(request,env.BUCKET,id);
      if(!review&&request.method==='GET'){
        const [data,changes]=await Promise.all([load(env.BUCKET,'data/'+id),load(env.BUCKET,'reviews/'+id)]);
        return data?json({...data.value,review:changes?.value||emptyReview()}):errors('Especie inexistente',404);
      }
    }
    return errors('Ruta no encontrada',404);
  } catch(e) {
    if(e instanceof SyntaxError||e instanceof TypeError && request.method!=='GET')return errors('Solicitud inválida',400);
    console.error('Portal request failed',path,e?.name);
    return errors('Servicio temporalmente no disponible',503);
  }
}};

