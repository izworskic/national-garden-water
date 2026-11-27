import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('public/assets/national-garden-water-page.js','utf8').replace(/^import .*;\n/,'');
function fixture(){
 const nodes=new Map();
 const node=s=>{if(!nodes.has(s))nodes.set(s,{value:'',hidden:true,dataset:{},textContent:'',checked:false,addEventListener(n,fn){this[n]=fn},scrollIntoView(){}});return nodes.get(s)};
 let fetcher;
 const json=d=>({ok:true,json:async()=>d});
 const init={crops:[{id:'generic',name:'Generic'}]};
 const ctx=vm.createContext({document:{querySelector:node},localStorage:{setItem(){},getItem(){return null}},navigator:{},Date,URLSearchParams,encodeURIComponent,fetch:async url=>url.includes('national-garden-water-crops')?json(init):fetcher(url),computeDecision:()=>({state:'WAIT',reason:'Evidence',nextCheck:'Tomorrow',metrics:{},confidence:'medium'}),selectRecentObservedRain:()=>({inches:0,confidence:'medium',source:'Observed'}),SOILS:{}});
 vm.runInContext(source,ctx);
 const submit=async value=>{node('#location').value=value;await node('#location-form').submit({preventDefault(){}})};
 const adjust=()=>node('#adjust-form').submit({preventDefault(){}});
 return {node,submit,adjust,setFetch:fn=>fetcher=fn,json};
}
const place=(zip)=>({latitude:zip==='96813'?21:43,longitude:-83,displayName:zip});
const evidence={referenceEt:{daily:[0.1]},recentRain:{},observedHistory:{},forecastRain:{},soil:{}};
test('failed new location context cannot retain old evidence or relabel it on adjust',async()=>{
 const f=fixture();f.setFetch(async u=>f.json(u.includes('geocode')?place('48706'):evidence));await f.submit('48706');assert.equal(f.node('#result').hidden,false);
 f.setFetch(async u=>u.includes('geocode')?f.json(place('96813')):{ok:false});await f.submit('96813');
 assert.equal(f.node('#result').hidden,true);assert.equal(f.node('#result').dataset.ready,undefined);
 f.adjust();assert.equal(f.node('#result').hidden,true);
 f.setFetch(async u=>f.json(u.includes('geocode')?place('96813'):evidence));await f.submit('96813');assert.equal(f.node('#result').hidden,false);assert.equal(f.node('#place').textContent,'96813');
});
test('superseded lookup cannot publish after newer failed request',async()=>{
 const f=fixture();let release,started;const pendingStarted=new Promise(r=>started=r);
 f.setFetch(async u=>{if(u.includes('99999'))return {ok:false,json:async()=>({error:'No mapped area'})};if(u.includes('geocode'))return f.json(place('48706'));started();return new Promise(r=>release=r)});
 const old=f.submit('48706');await pendingStarted;await f.submit('99999');release(f.json(evidence));await old;
 assert.equal(f.node('#result').hidden,true);assert.equal(f.node('.status').textContent,'No mapped area');
});