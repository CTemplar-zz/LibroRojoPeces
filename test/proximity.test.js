import {test} from 'node:test';
import assert from 'node:assert/strict';
import {geodesicDistance,classifyDuplicates} from '../worker/proximity.js';

test('umbral geodésico WGS84 de 100 m y vecindad transitiva',()=>{
  const origin={x:0,y:0},at100={x:0.0008983152841195215,y:0};
  assert.ok(Math.abs(geodesicDistance(origin,at100)-100)<.0001);
  assert.ok(Math.abs(geodesicDistance(origin,{x:0,y:0.0009043694770496})-100)<.0001);
  const p=[{id:'a',...origin},{id:'b',...at100},{id:'c',x:at100.x*2,y:0},{id:'d',x:at100.x*3.01,y:0}];
  const result=classifyDuplicates(p);
  assert.equal(result.candidates,3);assert.equal(result.groups,1);
  assert.deepEqual(p.map(x=>x.duplicateNeighbors),[1,2,1,0]);
  assert.equal(p[0].duplicateGroup,p[2].duplicateGroup);
  assert.equal(p[3].possibleDuplicate,false);
});

test('puntos coincidentes, fuentes iguales y exclusiones al depurar',()=>{
  const points=Array.from({length:2000},(_,i)=>({id:String(i).padStart(20,'0'),x:-64,y:-17,source:'ICTIO'}));
  let result=classifyDuplicates(points);
  assert.equal(result.candidates,2000);assert.equal(points[0].duplicateNeighbors,1999);assert.equal(points[0].nearestDuplicateM,0);
  const pair=[{id:'a',x:-64,y:-17},{id:'b',x:-64,y:-17}];
  result=classifyDuplicates(pair,{points:{b:{excluded:true}}});
  assert.equal(result.candidates,0);assert.ok(pair.every(p=>!p.possibleDuplicate));
  pair[1].x=-63;result=classifyDuplicates(pair);assert.equal(result.candidates,0);
});

test('la búsqueda espacial coincide con una comparación exhaustiva en Bolivia y el antimeridiano',()=>{
  const points=[];let random=12345;
  const next=()=>{random=(1664525*random+1013904223)>>>0;return random/2**32;};
  for(let i=0;i<200;i++)points.push({id:String(i).padStart(20,'0'),x:-64+(next()-.5)*.01,y:-17+(next()-.5)*.01});
  points.push({id:'east',x:179.9999,y:-17},{id:'west',x:-179.9999,y:-17});
  const expected=points.map((p,i)=>points.filter((q,j)=>i!==j&&geodesicDistance(p,q)<=100+1e-6).length);
  classifyDuplicates(points);
  assert.deepEqual(points.map(p=>p.duplicateNeighbors),expected);
});
