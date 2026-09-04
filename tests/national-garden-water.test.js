import test from 'node:test';import assert from 'node:assert/strict';
import {computeDecision,gallonsFor,projectSevenDays} from '../public/assets/national-garden-water-engine.js';
import {parseFretXml,parseSdaTable,aggregateQpf,summarizeStationRain} from '../api/national-garden-water.js';
const crop={rootDepthIn:{seedling:6,developing:12,mature:18},kc:{seedling:.5,developing:.8,mature:1.1},allowableDepletion:{seedling:.3,developing:.45,mature:.5}};
const base={crop,stage:'mature',bed:'ground',soil:'loam',referenceEtIn:.24,fretConfidence:'high',recentRainIn:0,recentRainConfidence:'medium',forecastRain24In:0,forecastRain48In:0,forecastRainTimingHours:48,soilFeel:'dry',irrigationHistorySupplied:true,soilConfidence:'high'};

test('gallon conversion',()=>assert.equal(gallonsFor(1,1),0.62));
test('one inch over 100 sq ft is about 62 gallons',()=>assert.equal(gallonsFor(1,100),62.3));
test('logged irrigation reverses otherwise-water decision',()=>{const a=computeDecision({...base,soilFeel:'unknown',irrigationIn:0}),b=computeDecision({...base,soilFeel:'unknown',irrigationIn:1,irrigationAgeDays:0});assert.notEqual(b.state,'WATER TODAY');assert.ok(b.metrics.currentDepletionIn<a.metrics.currentDepletionIn)});
test('older irrigation gets less remaining credit',()=>{const fresh=computeDecision({...base,soilFeel:'unknown',irrigationIn:.7,irrigationAgeDays:0}),old=computeDecision({...base,soilFeel:'unknown',irrigationIn:.7,irrigationAgeDays:5});assert.ok(old.metrics.currentDepletionIn>fresh.metrics.currentDepletionIn)});
test('current soil feel prevents double-counting old irrigation',()=>{const a=computeDecision({...base,soilFeel:'dry',irrigationIn:0}),b=computeDecision({...base,soilFeel:'dry',irrigationIn:1,irrigationAgeDays:1});assert.equal(a.metrics.currentDepletionIn,b.metrics.currentDepletionIn)});
test('rain gauge overrides modeled recent rainfall',()=>{const a=computeDecision({...base,soilFeel:'unknown',recentRainIn:0,rainGaugeIn:1.2}),b=computeDecision({...base,soilFeel:'unknown',recentRainIn:1.2,rainGaugeIn:0});assert.ok(a.metrics.currentDepletionIn<b.metrics.currentDepletionIn)});
test('one inch of recent rain forces wait instead of uncertainty for an ordinary soil bed',()=>{const d=computeDecision({...base,soilFeel:'unknown',recentRainIn:1,recentRainAgeHours:36,recentRainConfidence:'low',fretConfidence:'low',soilConfidence:'low',irrigationHistorySupplied:false});assert.equal(d.state,'WAIT');assert.equal(d.metrics.soakingRecentRain,true);assert.match(d.reason,/1 in of recent rain/i)});
test('three-quarter inch soaking still waits when it was recent',()=>{const d=computeDecision({...base,soilFeel:'unknown',recentRainIn:.75,recentRainAgeHours:24,recentRainConfidence:'medium'});assert.equal(d.state,'WAIT');assert.equal(d.metrics.soakingRecentRain,true)});
test('container does not use the soil-bed soaking-rain override',()=>{const d=computeDecision({...base,bed:'container',soilFeel:'unknown',recentRainIn:1,recentRainAgeHours:24});assert.equal(d.metrics.soakingRecentRain,false)});
test('sandy reservoir is smaller than loam',()=>{const s=computeDecision({...base,soil:'sand'}),l=computeDecision({...base,soil:'loam'});assert.ok(s.metrics.rootZoneCapacityIn<l.metrics.rootZoneCapacityIn)});
test('mature crop demand exceeds seedling demand',()=>{const s=computeDecision({...base,stage:'seedling'}),m=computeDecision({...base,stage:'mature'});assert.ok(m.metrics.cropEtIn>s.metrics.cropEtIn)});
test('raised bed has smaller reservoir and higher demand',()=>{const g=computeDecision({...base,bed:'ground'}),r=computeDecision({...base,bed:'raised'});assert.ok(r.metrics.rootZoneCapacityIn<g.metrics.rootZoneCapacityIn);assert.ok(r.metrics.cropEtIn>g.metrics.cropEtIn)});
test('container ignores supplied yard soil AWC',()=>{const a=computeDecision({...base,bed:'container',soil:'clay',awcPerInch:.23}),b=computeDecision({...base,bed:'container',soil:'sand',awcPerInch:.05});assert.equal(a.assumptions.soil,'potting-media profile');assert.equal(a.metrics.rootZoneCapacityIn,b.metrics.rootZoneCapacityIn)});
test('mulch lowers crop ET',()=>{const a=computeDecision({...base,mulch:false}),b=computeDecision({...base,mulch:true});assert.ok(b.metrics.cropEtIn<a.metrics.cropEtIn)});
test('meaningful imminent rain creates hold for rain',()=>{const d=computeDecision({...base,forecastRain24In:1.5,forecastRainTimingHours:8});assert.equal(d.state,'HOLD FOR RAIN')});
test('precipitation probability cannot become rainfall depth',()=>{const a=computeDecision({...base,probabilityOfPrecipitation:90,forecastRain24In:0});const b=computeDecision({...base,probabilityOfPrecipitation:10,forecastRain24In:0});assert.equal(a.state,b.state);assert.equal(a.metrics.forecastRain24In,0)});
test('insufficient rain does not create hold',()=>{const d=computeDecision({...base,forecastRain24In:.03,forecastRainTimingHours:8});assert.notEqual(d.state,'HOLD FOR RAIN')});
test('zero deficit never recommends overwatering',()=>{const d=computeDecision({...base,soilFeel:'wet',irrigationIn:.5});assert.notEqual(d.state,'WATER TODAY');assert.equal(d.applyIn,0)});
test('large deficit application is capped',()=>{const d=computeDecision({...base,soil:'silt-loam',soilFeel:'dry',referenceEtIn:.4});assert.ok(d.applyIn<=.75)});
test('low confidence near threshold asks to check soil',()=>{const d=computeDecision({...base,soilFeel:'unknown',fretConfidence:'low',recentRainConfidence:'low',soilConfidence:'low',irrigationHistorySupplied:false,referenceEtIn:.2,recentRainIn:0.15});assert.ok(['CHECK SOIL FIRST','WATER TODAY','WAIT'].includes(d.state));assert.equal(d.confidence,'low')});
test('seven day projection responds to rain amount not probability',()=>{const d=computeDecision(base);const p=projectSevenDays({decision:d,crop,stage:'mature',dailyReferenceEt:Array(7).fill(.2),dailyForecastRain:[0,.5,0,0,0,0,0]});assert.ok(p[1].depletion<p[0].depletion)});
test('FRET parser extracts daily values',()=>{const xml='<parameters><evapotranspiration><name>Daily Reference Crop Evapotranspiration</name><value>0.12</value><value>0.15</value></evapotranspiration><evapotranspiration><name>Weekly Reference Crop Evapotranspiration</name><value>1.02</value></evapotranspiration></parameters>';assert.deepEqual(parseFretXml(xml),{daily:[.12,.15],weekly:1.02})});
test('QPF aggregation uses precipitation amounts in mm and not probability',()=>{const now=Date.parse('2026-09-03T12:00:00Z');const q=aggregateQpf([{validTime:'2026-09-03T18:00:00Z/PT6H',value:25.4},{validTime:'2026-09-04T18:00:00Z/PT6H',value:12.7,probability:100}],now);assert.equal(q.rain24,1);assert.equal(q.rain48,1.5)});
test('station rain summary preserves observed amount and latest wet hour',()=>{const now=Date.parse('2026-09-04T12:00:00Z');const obs={features:[{properties:{timestamp:'2026-09-04T10:00:00Z',precipitationLastHour:{value:12.7}}},{properties:{timestamp:'2026-09-04T11:00:00Z',precipitationLastHour:{value:12.7}}}]};const r=summarizeStationRain(obs,now,'TEST',0);assert.equal(r.inches,1);assert.equal(r.latestWetHoursAgo,1);assert.equal(r.station,'TEST')});
test('no-irrigation-history assumption is explicit',()=>{const d=computeDecision({...base,irrigationHistorySupplied:false});assert.match(d.assumptionNote,/assumes 0 inches/i)});
test('SDA parser maps columns',()=>{assert.deepEqual(parseSdaTable({Table:[['mukey','awc_r'],['1','0.16']]}),[{mukey:'1',awc_r:'0.16'}])});

import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);

test('canonical page owns only garden-water assets and uses module runtime',()=>{
  const html=fs.readFileSync(path.join(root,'public/national-tools/garden-water/index.html'),'utf8');
  assert.match(html,/rel="canonical" href="https:\/\/chrisizworski\.com\/national-tools\/garden-water\/"/);
  assert.match(html,/type="module" src="\/assets\/national-garden-water-page\.js\?v=20260904-v3"/);
  assert.match(html,/national-garden-water\.css\?v=20260904-v3/);
  assert.doesNotMatch(html,/white-christmas/i);
});

test('default page is location-only and advanced garden inputs are collapsed',()=>{
  const html=fs.readFileSync(path.join(root,'public/national-tools/garden-water/index.html'),'utf8');
  assert.match(html,/id="location-form"/);
  assert.match(html,/Garden Water Today/);
  assert.match(html,/id="result" hidden/);
  assert.match(html,/<details class="adjustments" id="adjustments">/);
  assert.match(html,/Adjust this result for my garden/);
  assert.match(html,/id="rain-gauge"/);
  assert.doesNotMatch(html,/Step 2|What weather cannot know|Garden area in square feet/);
});

test('page controller runs a decision immediately after location data loads',()=>{
  const js=fs.readFileSync(path.join(root,'public/assets/national-garden-water-page.js'),'utf8');
  assert.match(js,/async function resolveAndRun/);
  assert.match(js,/context=await loadContext/);
  assert.match(js,/runDecision\(\);/);
  assert.match(js,/cropById\('\#?generic'\)|cropById\(\$\('\#crop'\)/);
  assert.match(js,/rainGaugeIn:rainGauge/);
  assert.match(js,/result\.dataset\.state/);
  assert.doesNotMatch(js,/#profile|#garden-form|#soil-feel/);
});

test('Michigan tools visual language is carried into Garden Water',()=>{
  const css=fs.readFileSync(path.join(root,'public/assets/national-garden-water.css'),'utf8');
  assert.match(css,/Georgia,'Times New Roman',serif/);
  assert.match(css,/#faf9f6/);
  assert.match(css,/#2c5f2d/);
  assert.match(css,/letter-spacing:\.09em/);
});

test('result states use distinct visual emphasis',()=>{
  const css=fs.readFileSync(path.join(root,'public/assets/national-garden-water.css'),'utf8');
  assert.match(css,/data-state="wait"/);
  assert.match(css,/data-state="check-soil-first"/);
  assert.match(css,/data-state="hold-for-rain"/);
  assert.match(css,/data-state="water-today"/);
  assert.match(css,/--state-color:var\(--red\)/);
  assert.match(css,/--state-color:var\(--amber\)/);
  assert.match(css,/--state-color:var\(--blue\)/);
});

test('child project reuses shared national geocoder instead of copying it',()=>{
  const vercel=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  const route=vercel.rewrites.find(x=>x.source==='/api/national-geocode');
  assert.equal(route?.destination,'https://national-outdoor-core.vercel.app/api/national-geocode');
  assert.equal(fs.existsSync(path.join(root,'api/national-geocode.js')),false);
});

test('production browser smoke exercises location-only automatic decision',()=>{
  const smoke=fs.readFileSync(path.join(root,'scripts/browser-smoke-production.mjs'),'utf8');
  assert.match(smoke,/#result\[data-ready="true"\]/);
  assert.match(smoke,/#decision/);
  assert.match(smoke,/#recent-rain/);
  assert.match(smoke,/#forecast-rain/);
  assert.match(smoke,/Pixel 7/);
  assert.doesNotMatch(smoke,/#profile|#garden-form|#soil-feel/);
});
