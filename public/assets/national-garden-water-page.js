import {computeDecision,projectSevenDays,SOILS} from './national-garden-water-engine.js';
const $=s=>document.querySelector(s); const fmt=n=>Number(n||0).toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
let crops=[]; let locationState=null; let context=null;
const form=$('#garden-form'),locForm=$('#location-form'),status=$('.status'),result=$('#result');

function saveProfile(){
  const data={crop:$('#crop').value,stage:$('#stage').value,bed:document.querySelector('input[name=bed]:checked')?.value||'ground',soil:$('#soil').value,mulch:$('#mulch').checked,area:$('#area').value,soilFeel:$('#soil-feel').value};
  localStorage.setItem('nationalGardenWaterProfileV1',JSON.stringify(data));
}
function loadProfile(){try{return JSON.parse(localStorage.getItem('nationalGardenWaterProfileV1')||'{}')}catch{return {}}}
function applyProfile(p){if(p.crop)$('#crop').value=p.crop;if(p.stage)$('#stage').value=p.stage;if(p.soil)$('#soil').value=p.soil;if(p.area)$('#area').value=p.area;if(p.soilFeel)$('#soil-feel').value=p.soilFeel;$('#mulch').checked=!!p.mulch;const r=document.querySelector(`input[name=bed][value="${p.bed||'ground'}"]`);if(r)r.checked=true;syncBed();}
function syncBed(){const bed=document.querySelector('input[name=bed]:checked')?.value;$('#soil-wrap').hidden=bed==='container';}
document.querySelectorAll('input[name=bed]').forEach(x=>x.addEventListener('change',syncBed));

async function geocode(q){const r=await fetch(`/api/national-geocode?q=${encodeURIComponent(q)}`);if(!r.ok)throw new Error('Location lookup failed');const d=await r.json();const lat=Number(d.latitude),lon=Number(d.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new Error('Location did not resolve');return {lat,lon,label:d.displayName||d.name||d.postcode||q};}
async function loadContext(lat,lon){const r=await fetch(`/api/national-garden-water?lat=${lat}&lon=${lon}`);if(!r.ok)throw new Error('Water context could not be refreshed');return r.json();}

locForm.addEventListener('submit',async e=>{e.preventDefault();status.textContent='Checking local weather, evapotranspiration and soil context…';try{locationState=await geocode($('#location').value.trim());context=await loadContext(locationState.lat,locationState.lon);$('#place').textContent=locationState.label;$('#profile').hidden=false;status.textContent='Location ready. Describe the garden below.';localStorage.setItem('nationalGardenWaterLocationV1',JSON.stringify(locationState));}catch(err){status.textContent=err.message||String(err)}});
$('#use-location').addEventListener('click',()=>{if(!navigator.geolocation){status.textContent='Device location is not available in this browser.';return}status.textContent='Getting your location…';navigator.geolocation.getCurrentPosition(async p=>{try{locationState={lat:p.coords.latitude,lon:p.coords.longitude,label:'Your location'};context=await loadContext(locationState.lat,locationState.lon);$('#place').textContent='your location';$('#profile').hidden=false;status.textContent='Location ready. Describe the garden below.';}catch(err){status.textContent=err.message||String(err)}},()=>status.textContent='Location permission was not granted.',{enableHighAccuracy:false,timeout:10000})});

function cropById(id){return crops.find(c=>c.id===id)||crops.find(c=>c.id==='generic')}
function selectedSoil(ctx,bed){if(bed==='container')return {id:'potting-mix',awc:SOILS['potting-mix'].awcPerInch,confidence:'medium',label:'Potting-media profile'};const manual=$('#soil').value;if(manual!=='auto')return {id:manual,awc:SOILS[manual]?.awcPerInch,confidence:'high',label:`Manual ${SOILS[manual]?.name||manual}`};const auto=ctx?.soil||{};return {id:auto.texture||'loam',awc:auto.awcPerInch||null,confidence:auto.confidence||'low',label:auto.mapUnitName?`${auto.mapUnitName} · NRCS`:'Automatic soil unavailable'};}
function irrigationInfo(){const date=$('#irrigation-date').value,amt=Number($('#irrigation-amount').value||0),none=$('#no-irrigation').checked;if(amt>0&&!date&&!none)throw new Error('Add the irrigation date so the tool knows how much of that watering may still be available.');const age=date?Math.max(0,Math.min(7,Math.floor((Date.now()-Date.parse(date+'T12:00:00'))/86400000))):0;return {amount:none?0:amt,supplied:none||!!date||amt>0,date:none?null:date,ageDays:age}}

form.addEventListener('submit',e=>{e.preventDefault();if(!context){status.textContent='Enter a location first.';return}saveProfile();let irr;try{irr=irrigationInfo()}catch(err){status.textContent=err.message;return}const bed=document.querySelector('input[name=bed]:checked')?.value||'ground';const c=cropById($('#crop').value),soil=selectedSoil(context,bed);const gauge=$('#rain-gauge').value===''?null:Number($('#rain-gauge').value);const eto=Number(context.referenceEt?.daily?.[0]||0);const decision=computeDecision({crop:c,stage:$('#stage').value,bed,soil:soil.id,awcPerInch:soil.awc,mulch:$('#mulch').checked,referenceEtIn:eto,fretConfidence:context.referenceEt?.confidence||'low',recentRainIn:Number(context.recentRain?.inches||0),recentRainConfidence:context.recentRain?.confidence||'low',irrigationIn:irr.amount,irrigationAgeDays:irr.ageDays,rainGaugeIn:gauge,soilFeel:$('#soil-feel').value,forecastRain24In:Number(context.forecastRain?.in24||0),forecastRain48In:Number(context.forecastRain?.in48||0),forecastRainTimingHours:Number(context.forecastRain?.firstWetHours||48),areaSqFt:Number($('#area').value||0)||null,irrigationHistorySupplied:irr.supplied,soilConfidence:soil.confidence});render(decision,c,bed,soil);});

function render(d,c,bed,soil){
  const title={'WATER TODAY':'Water today','WAIT':'Wait','CHECK SOIL FIRST':'Check soil first','HOLD FOR RAIN':'Hold for rain'}[d.state];
  $('#decision').textContent=title;
  $('#amount').textContent=d.state==='WATER TODAY'?`Apply about ${fmt(d.applyIn)} in${d.gallons?` · about ${d.gallons} gallons`:''}`:d.state==='HOLD FOR RAIN'?`About ${fmt(d.metrics.forecastRain24In)} in is forecast soon`:'No irrigation amount recommended right now';
  $('#why').textContent=d.reason;$('#next-check').textContent=d.nextCheck;$('#confidence').textContent=d.confidence;
  $('#reserve').textContent=`${Math.max(0,d.metrics.reservePct)}%`;$('#reserve-fill').style.width=`${Math.max(0,Math.min(100,d.metrics.reservePct))}%`;
  $('#m-water-in').textContent=`${fmt(d.metrics.recentWaterIn)} in`;$('#m-water-out').textContent=`${fmt(d.metrics.cropEtIn)} in/day`;$('#m-root').textContent=`${fmt(d.metrics.rootZoneCapacityIn)} in`;$('#m-rain').textContent=`${fmt(d.metrics.forecastRain24In)} in`;
  $('#assumption-line').textContent=d.assumptionNote;$('#source-line').textContent=`${context.referenceEt?.source||'ET source unavailable'} · ${context.forecastRain?.source||'NWS forecast'} · ${bed==='container'?'container media profile':soil.label}. This is a modeled reserve, not a soil-moisture measurement.`;
  const week=projectSevenDays({decision:d,crop:c,stage:$('#stage').value,bed,mulch:$('#mulch').checked,dailyReferenceEt:context.referenceEt?.daily||[],dailyForecastRain:context.forecastRain?.daily||[]});
  $('#week').innerHTML=week.map((x,i)=>`<div class="day"><span>${['Today','Day 2','Day 3','Day 4','Day 5','Day 6','Day 7'][i]}</span><strong>${x.reservePct}%</strong><span>reserve</span><br><span>${fmt(x.rain)} in rain</span></div>`).join('');
  result.dataset.ready='true';result.scrollIntoView({behavior:'smooth',block:'start'});
}

$('#no-irrigation').addEventListener('change',()=>{const off=$('#no-irrigation').checked;$('#irrigation-date').disabled=off;$('#irrigation-amount').disabled=off;if(off){$('#irrigation-date').value='';$('#irrigation-amount').value='';}});
(async function init(){
  $('#irrigation-date').max=new Date().toISOString().slice(0,10);
  const d=await fetch('/data/national-garden-water-crops.json').then(r=>r.json());crops=d.crops;$('#crop').innerHTML=crops.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');applyProfile(loadProfile());
  try{const saved=JSON.parse(localStorage.getItem('nationalGardenWaterLocationV1')||'null');if(saved?.lat&&saved?.lon){locationState=saved;$('#location').value=saved.label||'';}}catch{}
})();
