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
const pagesOrigin='https://ctemplar-zz.github.io';
const referenceKey=/^(?:index|departments|overview|regional|g-\d{1,3}-\d{1,3})$/;
const referenceRoute=/^\/api\/reference\/([^/]+)$/;
const thematicRoute=/^\/api\/thematic\/(basins|manifest|deforestation\.tif|fire\.tif)$/;
const thematicObject=key=>'thematic/20261119/'+key;
async function seedThematic(request,env,key){
  if(!env.THEMATIC_IMPORT_TOKEN||!await safeEqual(request.headers.get('authorization')||'','Bearer '+env.THEMATIC_IMPORT_TOKEN))return errors('Acceso restringido',401);
  if(await env.BUCKET.head(thematicObject('manifest')))return errors('Las capas temáticas ya están publicadas',409);
  if(key==='manifest'){
    const data=await request.json();
    if(data.basins!==21||!Array.isArray(data.rasters)||data.rasters.length!==2)return errors('Manifiesto inválido',400);
    for(const name of ['basins','deforestation.tif','fire.tif'])if(!await env.BUCKET.head(thematicObject(name)))return errors('Falta una capa',409);
    return json({stored:!!await env.BUCKET.put(thematicObject(key),JSON.stringify(data),{onlyIf:{etagDoesNotMatch:'*'}})});
  }
  if(key==='basins'){
    const raw=await request.text(),data=JSON.parse(raw);
    if(data.type!=='FeatureCollection'||data.features?.length!==21)return errors('Cuencas inválidas',400);
    await env.BUCKET.put(thematicObject(key),raw);
  }else{
    const length=Number(request.headers.get('content-length'));
    if(!length||length>100_000_000)return errors('Tamaño de ráster no permitido',413);
    await env.BUCKET.put(thematicObject(key),request.body,{httpMetadata:{contentType:'image/tiff'}});
  }
  return json({stored:true});
}
async function serveThematic(request,env,key){
  if(!key.endsWith('.tif')){
    const obj=await env.BUCKET.get(thematicObject(key));
    return obj?new Response(obj.body,{headers:{...headers,'content-type':'application/json; charset=utf-8'}}):errors('Capa no disponible',404);
  }
  const meta=await env.BUCKET.head(thematicObject(key));
  if(!meta)return errors('Ráster no disponible',404);
  const h={...headers,'content-type':'image/tiff','accept-ranges':'bytes'};
  const range=request.headers.get('range');
  if(!range)return errors('El ráster requiere lectura por rangos',400);
  const parsed=range.match(/^bytes=(\d+)-(\d*)$/);
  if(!parsed)return new Response(null,{status:416,headers:{...h,'content-range':'bytes */'+meta.size}});
  const offset=Number(parsed[1]),end=parsed[2]?Math.min(Number(parsed[2]),meta.size-1):meta.size-1;
  if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(end)||offset>end||offset>=meta.size)return new Response(null,{status:416,headers:{...h,'content-range':'bytes */'+meta.size}});
  const length=end-offset+1;
  if(length>8_000_000)return errors('Rango demasiado grande',413);
  const obj=await env.BUCKET.get(thematicObject(key),{range:{offset,length}});
  return new Response(obj.body,{status:206,headers:{...h,'content-range':'bytes '+offset+'-'+end+'/'+meta.size,'content-length':String(length)}});
}

const pagesPath=/^\/api\/(?:catalog|login|logout|reviews|species\/[a-z][a-z-]{2,100}(?:\/review)?)$/;
const referenceObject=key=>'reference/v1/'+key;
const tokenPattern=/^\d+\.[a-f0-9]{32}\.[a-f0-9]{64}$/;
const fromPages=request=>request.headers.get('origin')===pagesOrigin;
function cors(response,preflight=false) {
  const headers=new Headers(response.headers);
  headers.set('access-control-allow-origin',pagesOrigin);
  headers.append('vary','Origin');
  headers.set('access-control-expose-headers','Content-Range, Accept-Ranges, Content-Length');
  if(preflight) {
    headers.set('access-control-allow-methods','GET, POST');
    headers.set('access-control-allow-headers','Authorization, Content-Type, Range');
    headers.append('vary','Access-Control-Request-Method, Access-Control-Request-Headers');
  }
  return new Response(response.body,{status:response.status,headers});
}
async function authenticated(request,env) {
  if(!env.SESSION_SECRET)return false;
  const pages=fromPages(request);
  const token=pages
    ? request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]
    : request.headers.get('cookie')?.match(/(?:^|;\s*)libro_rojo=([^;]+)/)?.[1];
  if(!token||!tokenPattern.test(token))return false;
  const [until,nonce,mac]=token.split('.');
  const payload=(pages?'pages:':'')+until+'.'+nonce;
  return Number(until)>Date.now()&&await safeEqual(mac,await sign(payload,env.SESSION_SECRET));
}
function cookie(request,value,maxAge) {
  const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
  return cookieName+'='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge+secure;
}
const speciesId = /^[a-z][a-z-]{2,100}$/;
const pointId = /^[a-f0-9]{20}$/;
const originAllowed = (request,url)=>!request.headers.has('origin') || request.headers.get('origin')===url.origin || fromPages(request);
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
async function seedReference(request,env,key) {
  if(!env.REFERENCE_IMPORT_TOKEN||!await safeEqual(request.headers.get('authorization')||'','Bearer '+env.REFERENCE_IMPORT_TOKEN))return errors('Acceso restringido',401);
  if(await env.BUCKET.head(referenceObject('index')))return errors('Las capas ya están publicadas',409);
  const raw=await request.text();
  if(raw.length>16_000_000)return errors('Archivo demasiado grande',413);
  const data=JSON.parse(raw);
  if(key==='index'){
    if(!Array.isArray(data.tiles)||data.tiles.length>300||data.tiles.some(k=>typeof k!=='string'||!/^g-\d{1,3}-\d{1,3}$/.test(k)))return errors('Índice inválido',400);
    const {objects}=await env.BUCKET.list({prefix:referenceObject(''),limit:400});
    const uploaded=new Set(objects.map(o=>o.key));
    if([...data.tiles,'departments','overview','regional'].some(k=>!uploaded.has(referenceObject(k))))return errors('Hay capas pendientes de subir',409);
    return json({stored:!!await env.BUCKET.put(referenceObject('index'),raw,{onlyIf:{etagDoesNotMatch:'*'}})});
  }
  if(key==='departments'?data.type!=='FeatureCollection'||data.features?.length!==9:!Array.isArray(data))return errors('Capa inválida',400);
  await env.BUCKET.put(referenceObject(key),raw);
  return json({stored:true});
}
async function reviewHistory(bucket,url){
  const species=url.searchParams.get('species')||'';
  const action=url.searchParams.get('action')||'exclude';
  const cursor=url.searchParams.get('cursor')||'';
  if(species&&!speciesId.test(species)||!['exclude','restore','all'].includes(action))return errors('Filtro inválido',400);
  let after=null;
  if(cursor){
    try{after=JSON.parse(atob(cursor));}catch{return errors('Página inválida',400);}
    if(!Array.isArray(after)||after.length!==3||after.some(x=>typeof x!=='string'))return errors('Página inválida',400);
  }
  const keys=[];
  if(species)keys.push('reviews/'+species);
  else{
    let continuation;
    do{
      const page=await bucket.list({prefix:'reviews/',limit:1000,...(continuation?{cursor:continuation}:{})});
      keys.push(...page.objects.map(o=>o.key).filter(k=>speciesId.test(k.slice(8))));
      continuation=page.truncated?page.cursor:null;
    }while(continuation);
  }
  const states=new Map(),entries=[];
  for(let start=0;start<keys.length;start+=8){
    const reviews=await Promise.all(keys.slice(start,start+8).map(async key=>({species:key.slice(8),review:(await load(bucket,key))?.value})));
    for(const {species,review} of reviews){
      if(!review)continue;
      states.set(species,review.points||{});
      for(const event of review.history||[]){
        if(action!=='all'&&event.action!==action)continue;
        const points=new Map((event.points||[]).map(p=>[p.id,p]));
        for(const id of event.ids||[]){
          entries.push({species,pointId:id,eventId:event.id,at:event.at,action:event.action,reason:event.reason,reviewer:event.reviewer,snapshot:points.get(id)});
        }
      }
    }
  }
  const compare=(a,b)=>a[0]===b[0]?(a[1]===b[1]?a[2].localeCompare(b[2]):a[1].localeCompare(b[1])):a[0].localeCompare(b[0]);
  const entryKey=r=>[r.at,r.eventId,r.pointId];
  entries.sort((a,b)=>-compare(entryKey(a),entryKey(b)));
  const filtered=after?entries.filter(e=>compare(entryKey(e),after)<0):entries;
  const page=filtered.slice(0,50);
  const speciesData=new Map();
  for(const id of new Set(page.map(e=>e.species))){
    const data=(await load(bucket,'data/'+id))?.value;
    speciesData.set(id,{name:data?.species?.name||id,points:new Map((data?.points||[]).map(p=>[p.id,p]))});
  }
  const items=page.map(e=>{
    const data=speciesData.get(e.species);
    const p=e.snapshot||data.points.get(e.pointId);
    const coordinate=p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?{x:p.x,y:p.y}:null;
    return {species:e.species,speciesName:data.name,pointId:e.pointId,eventId:e.eventId,at:e.at,action:e.action,reason:e.reason,reviewer:e.reviewer,
      coordinate,source:p?.source||'',url:p?.url||'',excluded:!!states.get(e.species)?.[e.pointId]?.excluded};
  });
  return json({items,total:entries.length,next:filtered.length>50?btoa(JSON.stringify(entryKey(page.at(-1)))):null});
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
    const lookup=new Map(data.value.points.map(p=>[p.id,p]));
    const points=selected.map(id=>{
      const p=lookup.get(id);
      return {id,x:p.x,y:p.y,source:p.source||'',url:p.url||''};
    });
    const event={id:crypto.randomUUID(),ids:selected,points,action,reviewer:name,reason:note,at};
    for(const p of selected)review.points[p]={excluded:action==='exclude',reviewer:name,reason:note,at};
    review.history.push(event);
    const onlyIf=current?{etagMatches:current.etag}:{etagDoesNotMatch:'*'};
    if(await bucket.put(key,JSON.stringify(review),{onlyIf}))return json(review);
  }
  return errors('Otra persona guardó cambios al mismo tiempo. Intenta de nuevo.',409);
}
const misses = new Map();
async function handle(request,env){
  const url=new URL(request.url);
  const path=url.pathname;
  try {
    if(path==='/'&&request.method==='GET')return new Response(html,{headers:{...headers,'content-type':'text/html; charset=utf-8'}});
    if(path.startsWith('/api/import-thematic/')&&request.method==='PUT'){
      const key=path.split('/').at(-1);
      return /^(basins|manifest|deforestation\.tif|fire\.tif)$/.test(key)?await seedThematic(request,env,key):errors('Ruta incorrecta',404);
    }
    if(path.startsWith('/api/import-reference/')&&request.method==='PUT'){
      const key=path.split('/').at(-1);
      return referenceKey.test(key)?await seedReference(request,env,key):errors('Ruta incorrecta',404);
    }
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
      if(fromPages(request))return json({token:payload+'.'+await sign('pages:'+payload,env.SESSION_SECRET)});
      return json({ok:true},200,{'set-cookie':cookie(request,payload+'.'+await sign(payload,env.SESSION_SECRET),28800)});
    }
    if(path==='/api/logout'&&request.method==='POST')return fromPages(request)
      ? json({ok:true})
      : json({ok:true},200,{'set-cookie':cookie(request,'',0)});
    if(!path.startsWith('/api/'))return errors('Ruta no encontrada',404);
    if(!await authenticated(request,env))return errors('Inicia sesión para continuar',401);
    if(path==='/api/reviews'&&request.method==='GET')return await reviewHistory(env.BUCKET,url);
    const thematic=path.match(thematicRoute);
    if(thematic&&request.method==='GET')return serveThematic(request,env,thematic[1]);
    const reference=path.match(referenceRoute);
    if(reference&&referenceKey.test(reference[1])&&request.method==='GET'){
      const obj=await env.BUCKET.get(referenceObject(reference[1]));
      return obj?new Response(obj.body,{headers:{...headers,'content-type':'application/json; charset=utf-8'}}):errors('Capa no disponible',404);
    }
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
}
export default {async fetch(request,env){
  if(!fromPages(request))return handle(request,env);
  const {pathname}=new URL(request.url);
  const reference=pathname.match(referenceRoute);
  if(!pagesPath.test(pathname)&&!(reference&&referenceKey.test(reference[1]))&&!thematicRoute.test(pathname))return errors('Ruta no encontrada',404);
  if(request.method==='OPTIONS'){
    const method=request.headers.get('access-control-request-method');
    const requested=(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
    if(!['GET','POST'].includes(method)||requested.some(h=>!['authorization','content-type','range'].includes(h)))return errors('Solicitud no permitida',403);
    return cors(new Response(null,{status:204,headers}),true);
  }
  if(!['GET','POST'].includes(request.method))return cors(errors('Método no permitido',405));
  return cors(await handle(request,env));
}};

