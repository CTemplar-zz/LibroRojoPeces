// WGS84 inverse distance. The fallback is only for nearly antipodal points;
// proximity candidates are preselected within 102 metres of one another.
export function geodesicDistance(a,b){
  const rad=Math.PI/180,f=1/298.257223563,A=6378137,B=(1-f)*A;
  const u1=Math.atan((1-f)*Math.tan(a.y*rad)),u2=Math.atan((1-f)*Math.tan(b.y*rad));
  const su1=Math.sin(u1),cu1=Math.cos(u1),su2=Math.sin(u2),cu2=Math.cos(u2);
  const L=(b.x-a.x)*rad;let lambda=L,sinSigma=0,cosSigma=1,sigma=0,sinAlpha=0,cosSqAlpha=1,cos2SigmaM=0;
  if(a.x===b.x&&a.y===b.y)return 0;
  for(let i=0;i<100;i++){
    const sl=Math.sin(lambda),cl=Math.cos(lambda);
    sinSigma=Math.hypot(cu2*sl,cu1*su2-su1*cu2*cl);
    if(!sinSigma)return 0;
    cosSigma=su1*su2+cu1*cu2*cl;sigma=Math.atan2(sinSigma,cosSigma);
    sinAlpha=cu1*cu2*sl/sinSigma;cosSqAlpha=1-sinAlpha*sinAlpha;
    cos2SigmaM=cosSqAlpha?cosSigma-2*su1*su2/cosSqAlpha:0;
    const C=f/16*cosSqAlpha*(4+f*(4-3*cosSqAlpha)),previous=lambda;
    lambda=L+(1-C)*f*sinAlpha*(sigma+C*sinSigma*(cos2SigmaM+C*cosSigma*(-1+2*cos2SigmaM*cos2SigmaM)));
    if(Math.abs(lambda-previous)<1e-12){
      const u=cosSqAlpha*(A*A-B*B)/(B*B),ka=1+u/16384*(4096+u*(-768+u*(320-175*u))),kb=u/1024*(256+u*(-128+u*(74-47*u)));
      const delta=kb*sinSigma*(cos2SigmaM+kb/4*(cosSigma*(-1+2*cos2SigmaM*cos2SigmaM)-kb/6*cos2SigmaM*(-3+4*sinSigma*sinSigma)*(-3+4*cos2SigmaM*cos2SigmaM)));
      return B*ka*(sigma-delta);
    }
  }
  const h=Math.sin((b.y-a.y)*rad/2)**2+Math.cos(a.y*rad)*Math.cos(b.y*rad)*Math.sin(L/2)**2;
  return 6371008.8*2*Math.asin(Math.min(1,Math.sqrt(h)));
}

export function classifyDuplicates(points,review={points:{}}){
  const locations=[],byCoordinate=new Map(),grid=new Map(),parent=[];
  for(const p of points){
    p.possibleDuplicate=false;p.duplicateGroup='';p.duplicateNeighbors=0;p.nearestDuplicateM=null;
    if(review.points?.[p.id]?.excluded||review.points?.[p.id]?.deleted)continue;
    const key=p.x+','+p.y;
    let n=byCoordinate.get(key);
    if(n===undefined){
      n=locations.length;byCoordinate.set(key,n);parent.push(n);
      const lat=p.y*Math.PI/180,lon=p.x*Math.PI/180,r=6371008.8/102;
      locations.push({x:p.x,y:p.y,points:[],neighbors:0,nearest:Infinity,cell:[Math.floor(r*Math.cos(lat)*Math.cos(lon)),Math.floor(r*Math.cos(lat)*Math.sin(lon)),Math.floor(r*Math.sin(lat))]});
    }
    locations[n].points.push(p);
  }
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(let i=0;i<locations.length;i++){
    const a=locations[i],[x,y,z]=a.cell;
    a.neighbors+=a.points.length-1;if(a.points.length>1)a.nearest=0;
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++){
      for(const j of grid.get([x+dx,y+dy,z+dz].join(','))||[]){
        const b=locations[j],distance=geodesicDistance(a,b);
        if(distance>100+1e-6)continue;
        a.neighbors+=b.points.length;b.neighbors+=a.points.length;
        a.nearest=Math.min(a.nearest,distance);b.nearest=Math.min(b.nearest,distance);
        parent[root(i)]=root(j);
      }
    }
    const key=a.cell.join(',');if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);
  }
  const groupIds=new Map();
  for(let i=0;i<locations.length;i++){
    const key=root(i);for(const p of locations[i].points)if(!groupIds.has(key)||p.id<groupIds.get(key))groupIds.set(key,p.id);
  }
  let candidates=0;const groups=new Set();
  for(let i=0;i<locations.length;i++){
    const a=locations[i];if(!a.neighbors)continue;
    const group='D-'+groupIds.get(root(i));groups.add(group);
    for(const p of a.points){
      p.possibleDuplicate=true;p.duplicateGroup=group;p.duplicateNeighbors=a.neighbors;
      p.nearestDuplicateM=Math.round(a.nearest*1000)/1000;candidates++;
    }
  }
  return {distanceM:100,candidates,groups:groups.size,criterion:'misma especie, registros activos, distancia geodésica WGS84 <= 100 m; grupos de vecinos conectados'};
}
