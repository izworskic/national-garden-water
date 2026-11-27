// Exercise the actual owner HTML, CSS and JS with deterministic, explicitly synthetic API packets.
// A passing run is build-candidate evidence, never a claim about deployed production.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const root=path.resolve('public');
const places={'48706':{latitude:43.603,longitude:-83.953,postcode:'48706',state:'Michigan',displayName:'Bay City, Michigan'},'96813':{latitude:21.316,longitude:-157.844,postcode:'96813',state:'Hawaii',displayName:'Honolulu, Hawaii'}};
const stamp=new Date().toISOString();
const recent=Array.from({length:10},(_,i)=>({date:new Date(Date.now()-(10-i)*86400000).toISOString().slice(0,10),rainIn:0,referenceEtIn:.22}));
let outage=false,delayNextMichigan=false,releasePending=null,requestCount=0,cropPending=null,holdCrop=false;
function packet(p){const hawaii=p.state==='Hawaii';return {location:{lat:p.latitude,lon:p.longitude,timeZone:hawaii?'Pacific/Honolulu':'America/Detroit'},referenceEt:{daily:[.24],confidence:'high',source:'QA synthetic reference ET'},observedHistory:{days:recent,coveredDays:10,requestedDays:14,confidence:'high',stationName:hawaii?'QA Hawaii station':'QA Michigan station',distanceMiles:2},recentRain:{todayIn:0,inches:hawaii?1:0,coverage:.95,latestWetHoursAgo:12},forecastRain:{in24:0,in48:0,firstWetHours:48,source:'QA synthetic forecast'},soil:{texture:hawaii?'sand':'loam',awcPerInch:hawaii?.08:.18,confidence:'high',mapUnitName:hawaii?'QA Hawaii soil':'QA Michigan soil'},generatedAt:stamp};}
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
const server=http.createServer(async(req,res)=>{
 try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/data/national-garden-water-crops.json'&&holdCrop){holdCrop=false;cropPending=()=>json(res,503,{error:'QA crop outage'});return;}
 if(u.pathname==='/api/national-geocode'){const p=places[u.searchParams.get('q')];return json(res,p?200:404,p||{error:'No mapped ZIP area'});}
 if(u.pathname==='/api/national-garden-water'){
  requestCount++;
  const p=Object.values(places).find(p=>p.latitude===Number(u.searchParams.get('lat'))&&p.longitude===Number(u.searchParams.get('lon')));
  if(!p)return json(res,400,{error:'Location mismatch'});
  if(outage)return json(res,503,{error:'QA decision source unavailable'});
  if(delayNextMichigan&&p.state==='Michigan'){delayNextMichigan=false;releasePending=()=>json(res,200,packet(p));return;}
  return json(res,200,packet(p));
 }
 let file=path.resolve(root,'.'+decodeURIComponent(u.pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 if(u.pathname.endsWith('/'))file=path.join(file,'index.html');
 const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream';
 const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(data);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:850},timezoneId:'America/Detroit'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const visible=async(s)=>page.locator(s).waitFor({state:'visible',timeout:10000});
  const hidden=async(s)=>page.locator(s).waitFor({state:'hidden',timeout:10000});
  const label=async(s,t)=>page.waitForFunction(({s,t})=>document.querySelector(s)?.innerText.includes(t),{s,t},{timeout:10000});
  const submit=async(zip)=>{await page.locator('#location').fill(zip);await page.locator('#location-form').evaluate(f=>f.requestSubmit());};
  const ready=async(state)=>{await visible('#decision');await label('#place',state);assert.equal(await page.locator('#result').getAttribute('data-ready'),'true');await label('#soil-read','QA '+state+' soil');await label('#assumption-line','QA '+state+' station');};
  const lookup=async(zip,state)=>{await submit(zip);await ready(state);};
  holdCrop=true;
  await page.goto(origin+'/national-tools/garden-water/');
  for(let i=0;i<100&&!cropPending;i++)await new Promise(r=>setTimeout(r,50));
  assert.ok(cropPending,'initial crop request started');
  await submit('48706');await label('.status','Checking recent rain');await hidden('#result');
  cropPending();cropPending=null;
  await label('.status','Crop profiles are temporarily unavailable');await hidden('#result');
  await lookup('48706','Michigan');await lookup('96813','Hawaii');
  await submit('99999');await label('.status','Location lookup failed');await hidden('#result');assert.equal(await page.locator('#result').getAttribute('data-ready'),null);
  await lookup('48706','Michigan');
  outage=true;await submit('96813');await label('.status','could not be refreshed');await hidden('#result');outage=false;
  await lookup('48706','Michigan');
  // The failed replacement never leaves the prior data active.
  await page.locator('#adjustments summary').click();await page.locator('#watered-recently').check();await page.locator('#irrigation-date').fill('');
  await submit('96813');await label('#place','Hawaii');await visible('#adjustment-error');await label('#adjustment-error','Add the date');await hidden('#decision-content');await hidden('#source-line');await visible('#irrigation-date');
  assert.equal(await page.locator('#result').getAttribute('data-ready'),null);
  await page.locator('#irrigation-date').fill(new Date(Date.now()-86400000).toISOString().slice(0,10));await page.locator('#adjust-form').evaluate(f=>f.requestSubmit());await ready('Hawaii');await label('#assumption-line','Your recent watering is included.');
  await page.locator('#rain-gauge').fill('11');await submit('48706');await visible('#adjustment-error');await label('#adjustment-error','0 to 10 inches');await hidden('#decision-content');await page.locator('#rain-gauge').fill('0.5');await page.locator('#adjust-form').evaluate(f=>f.requestSubmit());await ready('Michigan');await label('#recent-rain-source','Your rain gauge');
  // Delay one valid request, resolve a newer location first, then release the old response.
  delayNextMichigan=true;await submit('48706');
  for(let i=0;i<100&&!releasePending;i++)await new Promise(r=>setTimeout(r,50));
  assert.ok(releasePending,'old decision request did not start');
  await hidden('#result');await lookup('96813','Hawaii');
  const delivered=page.waitForResponse(r=>r.url().includes('/api/national-garden-water?lat=43.603'));
  releasePending();releasePending=null;await delivered;await page.waitForTimeout(200);
  await ready('Hawaii');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({width,invalidZipCleared:true,decision503Cleared:true,locationRecovery:true,irrigationValidationRecovery:true,rainGaugeRecovery:true,supersededResponseRejected:true,cropInitializationRecovery:true,source:'synthetic fixture; actual owner UI and engine'}));await page.close();
 }
 assert.ok(requestCount>=12);
}finally{if(releasePending)releasePending();if(cropPending)cropPending();await browser.close();server.close();}
