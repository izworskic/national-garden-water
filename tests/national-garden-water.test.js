import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {computeDecision,gallonsFor,projectSevenDays,replayObservedWaterBalance,selectRecentObservedRain} from '../public/assets/national-garden-water-engine.js';
import {parseFretXml,parseSdaTable,aggregateQpf,summarizeStationRain,chooseNceiDailyStation,observedHargreavesEtIn} from '../api/national-garden-water.js';

const crop={rootDepthIn:{seedling:6,developing:12,mature:18},kc:{seedling:.5,developing:.8,mature:1.1},allowableDepletion:{seedling:.3,developing:.45,mature:.5}};
const history=(n,{rain=0,eto=.22,start='2026-08-20'}={})=>Array.from({length:n},(_,i)=>{const d=new Date(`${start}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+i);return {date:d.toISOString().slice(0,10),rainIn:rain,referenceEtIn:eto};});
const base={crop,stage:'mature',bed:'ground',soil:'loam',referenceEtIn:.24,fretConfidence:'high',observedHistoryDays:history(7),historyConfidence:'high',currentObservedRainIn:0,recentRainIn:0,recentRainConfidence:'medium',forecastRain24In:0,forecastRain48In:0,forecastRainTimingHours:48,soilFeel:'unknown',irrigationHistorySupplied:true,soilConfidence:'high'};
const root=path.resolve(new URL('..',import.meta.url).pathname);

test('gallon conversion',()=>assert.equal(gallonsFor(1,1),0.62));
test('one inch over 100 sq ft is about 62 gallons',()=>assert.equal(gallonsFor(1,100),62.3));

test('unknown starting moisture is a range, never a guessed average',()=>{
  const r=replayObservedWaterBalance({days:[],capacityIn:2.88,crop,todayReferenceEtIn:0});
  assert.equal(r.minDepletionIn,0);assert.equal(r.maxDepletionIn,2.88);
});

test('sparse NWS hourly coverage uses NOAA completed days plus today for the recent-rain signal',()=>{
  const r=selectRecentObservedRain({
    historyDays:[{date:'2026-09-01',rainIn:0},{date:'2026-09-02',rainIn:.1},{date:'2026-09-03',rainIn:.95}],
    todayRainIn:0,stationRainIn:0,stationCoverage:.2,stationRainAgeHours:72,
    generatedAt:'2026-09-04T14:00:00Z',timeZone:'America/Detroit'
  });
  assert.equal(r.inches,1.05);assert.equal(r.ageHours,72);assert.equal(r.confidence,'medium');assert.match(r.source,/NOAA daily summaries/i);
  const d=computeDecision({...base,observedHistoryDays:[],historyConfidence:'low',recentRainIn:r.inches,recentRainConfidence:r.confidence,recentRainAgeHours:r.ageHours});
  assert.equal(d.state,'WAIT');assert.equal(d.metrics.soakingRecentRain,true);
});

test('well-covered NWS 72-hour rain stays authoritative over a different daily station total',()=>{
  const r=selectRecentObservedRain({
    historyDays:[{date:'2026-09-01',rainIn:.4},{date:'2026-09-02',rainIn:.4},{date:'2026-09-03',rainIn:.4}],
    todayRainIn:0,stationRainIn:.1,stationCoverage:.9,stationRainAgeHours:12,
    generatedAt:'2026-09-04T14:00:00Z',timeZone:'America/Detroit'
  });
  assert.equal(r.inches,.1);assert.equal(r.ageHours,12);assert.equal(r.confidence,'medium');assert.match(r.source,/NWS station observations/i);
});

test('one incomplete NOAA day is not enough to replace sparse NWS observations',()=>{
  const r=selectRecentObservedRain({historyDays:[{date:'2026-09-03',rainIn:1}],stationRainIn:.2,stationCoverage:.3,stationRainAgeHours:24,generatedAt:'2026-09-04T14:00:00Z',timeZone:'America/Detroit'});
  assert.equal(r.inches,.2);assert.equal(r.confidence,'low');assert.match(r.source,/NWS hourly station observations/i);
});

test('actual dry observed history can prove watering is needed',()=>{
  const d=computeDecision({...base,observedHistoryDays:history(9),historyConfidence:'high'});
  assert.equal(d.state,'WATER TODAY');assert.ok(d.metrics.minDepletionIn>=d.metrics.stressTriggerIn);
});

test('actual soaking history can collapse uncertainty to a no-water result',()=>{
  const wet=[...history(4),{date:'2026-08-24',rainIn:4,referenceEtIn:.16},{date:'2026-08-25',rainIn:0,referenceEtIn:.18},{date:'2026-08-26',rainIn:0,referenceEtIn:.18}];
  const d=computeDecision({...base,observedHistoryDays:wet,historyConfidence:'high',referenceEtIn:.18});
  assert.equal(d.state,'WAIT');assert.ok(d.metrics.maxDepletionIn<d.metrics.stressTriggerIn);
});

test('missing historical coverage does not invent a wet-enough answer',()=>{
  const d=computeDecision({...base,observedHistoryDays:[],historyConfidence:'low',referenceEtIn:.15});
  assert.equal(d.state,'CHECK SOIL FIRST');assert.match(d.reason,/both a wet-enough and a dry-enough/i);
});

test('logged irrigation reverses an otherwise-water decision using observed drying',()=>{
  const a=computeDecision({...base,irrigationIn:0}),b=computeDecision({...base,irrigationIn:1,irrigationAgeDays:0});
  assert.equal(a.state,'WATER TODAY');assert.notEqual(b.state,'WATER TODAY');assert.ok(b.metrics.minDepletionIn<a.metrics.minDepletionIn);
});

test('older irrigation gets less remaining credit based on observed ET',()=>{
  const fresh=computeDecision({...base,irrigationIn:1,irrigationAgeDays:0}),old=computeDecision({...base,irrigationIn:1,irrigationAgeDays:5});
  assert.ok(old.metrics.minDepletionIn>fresh.metrics.minDepletionIn);
});

test('current soil feel still overrides weather uncertainty',()=>{
  const a=computeDecision({...base,soilFeel:'dry',irrigationIn:0}),b=computeDecision({...base,soilFeel:'dry',irrigationIn:1,irrigationAgeDays:1});
  assert.equal(a.metrics.minDepletionIn,b.metrics.minDepletionIn);assert.equal(a.metrics.minDepletionIn,a.metrics.maxDepletionIn);
});

test('rain gauge corrects rather than double-counts recent observed rainfall',()=>{
  const a=computeDecision({...base,recentRainIn:.2,rainGaugeIn:1.2}),b=computeDecision({...base,recentRainIn:.2,rainGaugeIn:.2});
  assert.ok(a.metrics.minDepletionIn<b.metrics.minDepletionIn);
});

test('one inch of recent observed rain forces wait for an ordinary soil bed',()=>{
  const d=computeDecision({...base,recentRainIn:1,recentRainAgeHours:36,recentRainConfidence:'low',fretConfidence:'low',soilConfidence:'low',irrigationHistorySupplied:false});
  assert.equal(d.state,'WAIT');assert.equal(d.metrics.soakingRecentRain,true);assert.match(d.reason,/1 in of recent observed rain/i);
});
test('three-quarter inch soaking still waits when recent',()=>{const d=computeDecision({...base,recentRainIn:.75,recentRainAgeHours:24});assert.equal(d.state,'WAIT')});
test('current-hour rain remains age zero',()=>{const d=computeDecision({...base,recentRainIn:.75,recentRainAgeHours:0});assert.equal(d.metrics.recentRainAgeHours,0);assert.equal(d.state,'WAIT')});
test('container excludes soil-bed soaking override',()=>{const d=computeDecision({...base,bed:'container',recentRainIn:1,recentRainAgeHours:24});assert.equal(d.metrics.soakingRecentRain,false)});

test('sandy reservoir is smaller than loam',()=>{const s=computeDecision({...base,soil:'sand',soilFeel:'dry'}),l=computeDecision({...base,soil:'loam',soilFeel:'dry'});assert.ok(s.metrics.rootZoneCapacityIn<l.metrics.rootZoneCapacityIn)});
test('mature crop demand exceeds seedling demand',()=>{const s=computeDecision({...base,stage:'seedling',soilFeel:'dry'}),m=computeDecision({...base,stage:'mature',soilFeel:'dry'});assert.ok(m.metrics.cropEtIn>s.metrics.cropEtIn)});
test('raised bed has smaller reservoir and higher demand',()=>{const g=computeDecision({...base,bed:'ground',soilFeel:'dry'}),r=computeDecision({...base,bed:'raised',soilFeel:'dry'});assert.ok(r.metrics.rootZoneCapacityIn<g.metrics.rootZoneCapacityIn);assert.ok(r.metrics.cropEtIn>g.metrics.cropEtIn)});
test('container ignores supplied yard soil AWC',()=>{const a=computeDecision({...base,bed:'container',soil:'clay',awcPerInch:.23,soilFeel:'dry'}),b=computeDecision({...base,bed:'container',soil:'sand',awcPerInch:.05,soilFeel:'dry'});assert.equal(a.assumptions.soil,'potting-media profile');assert.equal(a.metrics.rootZoneCapacityIn,b.metrics.rootZoneCapacityIn)});
test('mulch lowers crop ET',()=>{const a=computeDecision({...base,mulch:false,soilFeel:'dry'}),b=computeDecision({...base,mulch:true,soilFeel:'dry'});assert.ok(b.metrics.cropEtIn<a.metrics.cropEtIn)});

test('meaningful imminent QPF creates hold for rain',()=>{const d=computeDecision({...base,forecastRain24In:1.5,forecastRainTimingHours:8});assert.equal(d.state,'HOLD FOR RAIN')});
test('precipitation probability cannot become rainfall depth',()=>{const a=computeDecision({...base,probabilityOfPrecipitation:90,forecastRain24In:0}),b=computeDecision({...base,probabilityOfPrecipitation:10,forecastRain24In:0});assert.equal(a.state,b.state);assert.equal(a.metrics.forecastRain24In,0)});
test('insufficient forecast rain does not create hold',()=>{const d=computeDecision({...base,forecastRain24In:.03,forecastRainTimingHours:8});assert.notEqual(d.state,'HOLD FOR RAIN')});
test('large deficit application is capped',()=>{const d=computeDecision({...base,observedHistoryDays:history(14,{eto:.35}),soil:'silt-loam',referenceEtIn:.4});assert.ok(d.applyIn<=.75)});
test('seven day projection responds to forecast rain amount',()=>{const d=computeDecision(base);const p=projectSevenDays({decision:d,crop,stage:'mature',dailyReferenceEt:Array(7).fill(.2),dailyForecastRain:[0,.5,0,0,0,0,0]});assert.ok(p[1].minDepletion<p[0].minDepletion)});

test('FRET parser extracts daily values',()=>{const xml='<parameters><evapotranspiration><name>Daily Reference Crop Evapotranspiration</name><value>0.12</value><value>0.15</value></evapotranspiration><evapotranspiration><name>Weekly Reference Crop Evapotranspiration</name><value>1.02</value></evapotranspiration></parameters>';assert.deepEqual(parseFretXml(xml),{daily:[.12,.15],weekly:1.02})});
test('QPF aggregation uses precipitation amounts in mm and not probability',()=>{const now=Date.parse('2026-09-03T12:00:00Z');const q=aggregateQpf([{validTime:'2026-09-03T18:00:00Z/PT6H',value:25.4},{validTime:'2026-09-04T18:00:00Z/PT6H',value:12.7,probability:100}],now);assert.equal(q.rain24,1);assert.equal(q.rain48,1.5)});
test('station rain summary preserves 72h amount and local-today amount',()=>{const now=Date.parse('2026-09-04T12:00:00Z');const obs={features:[{properties:{timestamp:'2026-09-04T10:00:00Z',precipitationLastHour:{value:12.7}}},{properties:{timestamp:'2026-09-04T02:00:00Z',precipitationLastHour:{value:12.7}}}]};const r=summarizeStationRain(obs,now,'TEST',0,'America/Detroit');assert.equal(r.inches,1);assert.equal(r.todayIn,.5);assert.equal(r.station,'TEST')});
test('observed Hargreaves ET uses actual daily temperatures',()=>{const e=observedHargreavesEtIn(84,61,43.6,'2026-09-01');assert.ok(e>.05&&e<.5)});
test('NCEI station selection rewards complete nearby daily records',()=>{const rows=[{STATION:'A',NAME:'Near sparse',LATITUDE:'43.60',LONGITUDE:'-83.90',DATE:'2026-09-01',PRCP:'0.1',TMAX:'80',TMIN:'60'},...Array.from({length:5},(_,i)=>({STATION:'B',NAME:'Complete',LATITUDE:'43.70',LONGITUDE:'-83.80',DATE:`2026-09-0${i+1}`,PRCP:'0',TMAX:'78',TMIN:'58'}))];const s=chooseNceiDailyStation(rows,43.6,-83.9);assert.equal(s.station,'B');assert.equal(s.completeDays,5)});
test('SDA parser maps columns',()=>{assert.deepEqual(parseSdaTable({Table:[['mukey','awc_r'],['1','0.16']]}),[{mukey:'1',awc_r:'0.16'}])});

test('engine permanently bans the synthetic starting-reserve baseline',()=>{
  const js=fs.readFileSync(path.join(root,'public/assets/national-garden-water-engine.js'),'utf8');
  assert.doesNotMatch(js,/taw\s*\*\s*0\.42|conservative modeled starting reserve/);assert.match(js,/NOAA\/NWS observed-weather uncertainty range/);assert.match(js,/replayObservedWaterBalance/);assert.match(js,/selectRecentObservedRain/);
});

test('API uses NOAA daily summaries actual precipitation and temperatures',()=>{
  const js=fs.readFileSync(path.join(root,'api/national-garden-water.js'),'utf8');
  assert.match(js,/dataset:'daily-summaries'/);assert.match(js,/search\/v1\/data/);assert.match(js,/stations:candidate.station/);assert.match(js,/dataTypes:'PRCP,TMAX,TMIN'/);assert.match(js,/NOAA NCEI Daily Summaries/);assert.match(js,/getObservedHistory/);
});

test('canonical page uses v5 assets and Michigan tools visual hierarchy',()=>{
  const html=fs.readFileSync(path.join(root,'public/national-tools/garden-water/index.html'),'utf8');
  assert.match(html,/rel="canonical" href="https:\/\/chrisizworski\.com\/national-tools\/garden-water\/"/);assert.match(html,/national-garden-water\.css\?v=20260904-v5/);assert.match(html,/national-garden-water-page\.js\?v=20260904-v5/);assert.match(html,/class="site-head"/);assert.match(html,/Michigan Tools/);assert.match(html,/Should I water my garden today\?/);assert.match(html,/id="recent-rain-source"/);assert.doesNotMatch(html,/white-christmas/i);
});

test('default page stays location-first with advanced inputs collapsed',()=>{
  const html=fs.readFileSync(path.join(root,'public/national-tools/garden-water/index.html'),'utf8');
  assert.match(html,/id="location-form"/);assert.match(html,/id="result" hidden/);assert.match(html,/<details class="adjustments" id="adjustments">/);assert.match(html,/id="rain-gauge"/);assert.doesNotMatch(html,/Step 2|Garden area in square feet/);
});

test('page controller uses one reconciled rain signal for both decision and display',()=>{
  const js=fs.readFileSync(path.join(root,'public/assets/national-garden-water-page.js'),'utf8');
  assert.match(js,/selectRecentObservedRain/);assert.match(js,/recentRainSignal=buildRecentRainSignal/);assert.match(js,/recentRainIn:recentRainSignal\.inches/);assert.match(js,/\#recent-rain-source/);assert.match(js,/national-garden-water-engine\.js\?v=20260904-v5/);assert.doesNotMatch(js,/conservative modeled starting reserve/);
});

test('Garden Water CSS matches the Michigan tools visual system and keeps state emphasis',()=>{
  const css=fs.readFileSync(path.join(root,'public/assets/national-garden-water.css'),'utf8');
  assert.match(css,/font-family:Georgia,"Times New Roman",serif/);assert.match(css,/--paper:#f8f6f1/);assert.match(css,/--green:#2c5f2d/);assert.match(css,/\.body\{max-width:920px/);assert.match(css,/\.site-head\{/);assert.match(css,/border-radius:6px/);assert.match(css,/data-state="wait"/);assert.match(css,/data-state="check-soil-first"/);assert.match(css,/data-state="hold-for-rain"/);assert.match(css,/data-state="water-today"/);assert.doesNotMatch(css,/linear-gradient/);
});

test('child project reuses shared national geocoder',()=>{
  const vercel=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));const route=vercel.rewrites.find(x=>x.source==='/api/national-geocode');assert.equal(route?.destination,'https://national-outdoor-core.vercel.app/api/national-geocode');assert.equal(fs.existsSync(path.join(root,'api/national-geocode.js')),false);
});
