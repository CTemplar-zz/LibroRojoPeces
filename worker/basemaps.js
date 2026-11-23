const basemapStylePaths={satellite:'imagery',relief:'terrain',topographic:'topographic',dark:'dark-gray'};
const nationalItem='3d1a30626bbc46c582f148b9252676ce';
const spriteItems=new Set([nationalItem,'30d6b8271e1849cd9c3042060001f425','14fbc125ccc9488888b014db09f35f67','7dc6cea0b1764a1f9af2e679f642f0f5','747cb7a5329c478cbe6981076cc879c5']);
const basemapCache=new Map();
const bheaders={'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const berror=(message,status=502)=>Response.json({error:message},{status,headers:bheaders});
const templates=value=>value.replace(/%7B(z|x|y|fontstack|range|ratio)%7D/gi,'{$1}');
function cleanBasemapUrl(value){
  const url=new URL(value);
  for(const key of [...url.searchParams.keys()])if(/token|key|auth/i.test(key))url.searchParams.delete(key);
  url.hash='';
  return url;
}
export function allowedBasemapAsset(value,spriteRoot=false){
  let url,path;try{url=cleanBasemapUrl(value);path=decodeURIComponent(url.pathname);}catch{return false;}
  if(url.protocol!=='https:'||url.username||url.password||url.port)return false;
  const vectorHost=['basemaps-api.arcgis.com','basemaps.arcgis.com'].includes(url.hostname);
  if(vectorHost){
    const prefix='/arcgis/rest/services/World_Basemap_v2/VectorTileServer/';
    if(!path.startsWith(prefix))return false;
    const part=path.slice(prefix.length);
    if(/^tile\/(?:\d{1,2}|\{z\})\/(?:\d+|\{y\})\/(?:\d+|\{x\})\.pbf$/.test(part))return true;
    return /^resources\/fonts\/[^/]+\/(?:\d+-\d+|\{range\})\.pbf$/.test(part);
  }
  if(url.hostname==='ibasemaps-api.arcgis.com')return /^\/arcgis\/rest\/services\/(?:World_Imagery|Elevation\/World_Hillshade)\/MapServer\/tile\/(?:\d{1,2}|\{z\})\/(?:\d+|\{y\})\/(?:\d+|\{x\})$/.test(path);
  if(url.hostname==='tiles.arcgis.com')return /^\/tiles\/P3ePLMYs2RVChkJx\/arcgis\/rest\/services\/NatGeoStyleBase\/MapServer\/tile\/(?:\d{1,2}|\{z\})\/(?:\d+|\{y\})\/(?:\d+|\{x\})$/.test(path);
  if(['cdn.arcgis.com','www.arcgis.com'].includes(url.hostname)){
    const match=path.match(/^\/sharing\/rest\/content\/items\/([a-f0-9]{32})\/resources\/sprites\/sprite(@2x)?(\.(?:json|png))?$/);
    return !!match&&spriteItems.has(match[1])&&(spriteRoot||!!match[3]);
  }
  return false;
}
function basemapAssetUrl(value,origin,sprite=false){
  const url=cleanBasemapUrl(value);
  if(url.hostname==='basemaps.arcgis.com')url.hostname='basemaps-api.arcgis.com';
  if(!allowedBasemapAsset(url.href,sprite))throw new Error('Unrecognized basemap resource');
  const encoded=encodeURIComponent(templates(url.href)).replace(/%7B(z|x|y|fontstack|range|ratio)%7D/gi,'{$1}');
  return origin+'/api/basemaps/'+(sprite?'sprite':'asset')+'?u='+encoded;
}
export function sanitizeBasemapStyle(input,origin,key){
  const style=structuredClone(input);delete style.metadata;
  if(style.version!==8||!style.sources||!Array.isArray(style.layers))throw new Error('Invalid basemap style');
  const credits=new Set();
  for(const source of Object.values(style.sources)){
    const attribution=String(source.attribution||source.copyrightText||'').replace(/<[^>]*>/g,'').replace(/^Sources?:\s*/i,'');
    if(attribution)credits.add(attribution);
    if(!source.tiles&&source.url){
      const base=cleanBasemapUrl(source.url).href.replace(/\/$/,'');
      source.tiles=[base+'/tile/{z}/{y}/{x}'+(source.type==='vector'?'.pbf':'')];
    }
    if(!source.tiles)throw new Error('Missing basemap tiles');
    source.tiles=source.tiles.map(value=>basemapAssetUrl(value,origin));delete source.url;
    if(source.type==='vector')source.maxzoom=Math.min(source.maxzoom??16,16);
    // Credits are displayed by Leaflet, outside the synchronized GL renderer.
    delete source.attribution;delete source.copyrightText;
  }
  if(style.glyphs)style.glyphs=basemapAssetUrl(style.glyphs,origin);
  if(style.sprite)style.sprite=basemapAssetUrl(style.sprite,origin,true);
  if(key&&JSON.stringify({style,credits:[...credits]}).includes(key))throw new Error('Unstripped access token');
  return {style,credits:[...credits].join('; ')};
}
async function basemapFetch(url,env){
  const target=new URL(url);
  const headers={Referer:'https://ctemplar-zz.github.io/LibroRojoPeces/'};
  if(/^(?:i?basemaps|basemapstyles)-api\.arcgis\.com$/.test(target.hostname)){
    target.searchParams.set('token',env.ARCGIS_LOCATION_API_KEY);
  }
  // Workers supports manual/follow; manual also prevents credentials following redirects.
  const options={headers,redirect:'manual'};
  // Workers requires the native fetch receiver to remain the global object.
  return env.BASEMAP_FETCH?env.BASEMAP_FETCH(target.href,options):globalThis.fetch(target.href,options);
}
export async function serveBasemap(request,env){
  if(!env.ARCGIS_LOCATION_API_KEY)return berror('Los mapas de ArcGIS aún no están configurados.',503);
  const url=new URL(request.url),match=url.pathname.match(/^\/api\/basemaps\/style\/(satellite|national-geographic|relief|topographic|dark)$/);
  let stage='request',remoteStatus=null,remoteType=null;
  try{
    if(match){
      const id=match[1],cacheKey=url.origin+'|'+id,cached=basemapCache.get(cacheKey);
      if(cached&&cached.until>Date.now())return Response.json(cached.data,{headers:bheaders});
      const remote=id==='national-geographic'
        ?'https://www.arcgis.com/sharing/rest/content/items/'+nationalItem+'/resources/styles/root.json'
        :'https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/'+basemapStylePaths[id]+'?language=es';
      stage='style-fetch';
      const response=await basemapFetch(remote,env);
      remoteStatus=response.status;remoteType=response.headers.get('content-type');stage='style-json';
      const input=await response.json();
      if(!response.ok||input.error)return berror('ArcGIS no autorizó el mapa base. Verifica la clave y sus permisos.');
      if(id==='national-geographic'){
        input.sources.nationalRelief={type:'raster',tiles:['https://ibasemaps-api.arcgis.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:23,attribution:'Esri, Airbus DS, USGS, NGA, NASA, CGIAR and the GIS user community'};
        input.sources.nationalBase={type:'raster',tiles:['https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/NatGeoStyleBase/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:9,attribution:'Esri, USGS, National Geographic Society'};
        input.sources.esri.attribution='Esri, TomTom, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors and the GIS User Community';
        input.layers.unshift({id:'national-relief',type:'raster',source:'nationalRelief',minzoom:8},{id:'national-physical-base',type:'raster',source:'nationalBase',maxzoom:10});
      }
      stage='style-sanitize';
      const data={id,...sanitizeBasemapStyle(input,url.origin,env.ARCGIS_LOCATION_API_KEY)};
      basemapCache.set(cacheKey,{data,until:Date.now()+600_000});
      return Response.json(data,{headers:bheaders});
    }
    const sprite=url.pathname.match(/^\/api\/basemaps\/sprite(@2x)?\.(json|png)$/);
    if(url.pathname!=='/api/basemaps/asset'&&!sprite)return berror('Mapa base inexistente',404);
    const raw=url.searchParams.get('u');if(!raw||raw.length>3000)return berror('Recurso inválido',400);
    const target=cleanBasemapUrl(raw);
    if(sprite)target.pathname+=(sprite[1]||'')+'.'+sprite[2];
    if(!allowedBasemapAsset(target.href))return berror('Recurso no permitido',400);
    // Reject out-of-range tile coordinates, independently of the remote host.
    const tile=decodeURIComponent(target.pathname).match(/\/tile\/(\d+)\/(\d+)\/(\d+)(?:\.pbf)?$/);
    if(tile){const [,z,y,x]=tile.map(Number);if(z>23||x>=2**z||y>=2**z)return berror('Tesela fuera de rango',400);}
    const response=await basemapFetch(target.href,env);
    if(!response.ok)return berror('No se pudo obtener una tesela de ArcGIS.');
    const type=response.headers.get('content-type')||'application/octet-stream';
    const bytes=await response.arrayBuffer();if(bytes.byteLength>8_000_000)return berror('Recurso demasiado grande');
    if(/json|text/.test(type)){
      let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{return berror('Respuesta inesperada de ArcGIS.');}
      if(value.error)return berror('ArcGIS no autorizó el recurso del mapa base.');
      if(new TextDecoder().decode(bytes).includes(env.ARCGIS_LOCATION_API_KEY))return berror('Respuesta inesperada de ArcGIS.');
    }
    return new Response(bytes,{headers:{...bheaders,'cache-control':'private, max-age=3600','content-type':type}});
  }catch(error){
    const known=new Set(['Invalid basemap style','Unrecognized basemap resource','Missing basemap tiles','Unstripped access token']);
    console.warn('ArcGIS basemap failure',JSON.stringify({stage,remoteStatus,remoteType,cause:known.has(error.message)?error.message:error.name}));
    return berror('No se pudo cargar el mapa base de ArcGIS. Intenta de nuevo.');
  }
}
