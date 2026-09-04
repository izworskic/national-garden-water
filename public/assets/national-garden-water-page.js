import {computeDecision,SOILS} from './national-garden-water-engine.js';

const $=s=>document.querySelector(s);
const fmt=n=>Number(n||0).toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
let crops=[];
let locationState=null;
let context=null;

const locForm=$('#location-form');
const adjustForm=$('#adjust-form');
const status=$('.status');
const result=$('#result');

async function geocode(q){
  const r=await fetch(`/api/national-geocode?q=${encodeURIComponent(q)}`);
  if(!r.ok)throw new Error('Location lookup failed');
  const d=await r.json();
  const lat=Number(d.latitude),lon=Number(d.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new Error('Location did not resolve');
  return {lat,lon,label:d.displayName||d.name||d.postcode||q};
}

async function loadContext(lat,lon){
  const r=await fetch(`/api/national-garden-water?lat=${lat}&lon=${lon}`);
  if(!r.ok)throw new Error('Garden water data could not be refreshed');
  return r.json();
}

function cropById(id){return crops.find(c=>c.id===id)||crops.find(c=>c.id==='generic');}

function selectedSoil(bed){
  if(bed==='container')return {id:'potting-mix',awc:SOILS['potting-mix'].awcPerInch,confidence:'medium',label:'Potting mix'};
  const auto=context?.soil||{};
  return {id:auto.texture||'loam',awc:auto.awcPerInch||null,confidence:auto.confidence||'low',label:auto.mapUnitName?auto.mapUnitName:(auto.texture?auto.texture.replaceAll('-',' '):'Estimated local soil')};
}

function irrigationInfo(){
  const enabled=$('#watered-recently').checked;
  if(!enabled)return {amount:0,ageDays:0,supplied:false};
  const date=$('#irrigation-date').value;
  const amount=Number($('#irrigation-amount').value||0.5);
  if(!date)throw new Error('Add the date you last watered.');
  const ageDays=Math.max(0,Math.min(7,Math.floor((Date.now()-Date.parse(date+'T12:00:00'))/86400000)));
  return {amount,ageDays,supplied:true};
}

function rainGaugeInfo(){
  const raw=$('#rain-gauge')?.value?.trim()||'';
  if(raw==='')return null;
  const amount=Number(raw);
  if(!Number.isFinite(amount)||amount<0||amount>10)throw new Error('Enter a rain-gauge amount from 0 to 10 inches.');
  return amount;
}

function currentSetup(){
  const bed=$('#bed').value||'ground';
  const crop=cropById($('#crop').value||'generic');
  const soil=selectedSoil(bed);
  const irrigation=irrigationInfo();
  const rainGauge=rainGaugeInfo();
  return {bed,crop,soil,irrigation,rainGauge,stage:$('#stage').value||'mature'};
}

function runDecision({scroll=true}={}){
  if(!context)return;
  let setup;
  try{setup=currentSetup();}catch(error){status.textContent=error.message;return;}
  const {bed,crop,soil,irrigation,rainGauge,stage}=setup;
  const eto=Number(context.referenceEt?.daily?.[0]||0);
  const decision=computeDecision({
    crop,stage,bed,soil:soil.id,awcPerInch:soil.awc,mulch:false,
    referenceEtIn:eto,fretConfidence:context.referenceEt?.confidence||'low',
    observedHistoryDays:context.observedHistory?.days||[],historyConfidence:context.observedHistory?.confidence||'low',
    currentObservedRainIn:Number(context.recentRain?.todayIn||0),
    recentRainIn:Number(context.recentRain?.inches||0),recentRainConfidence:context.recentRain?.confidence||'low',
    recentRainAgeHours:Number(context.recentRain?.latestWetHoursAgo??72),
    irrigationIn:irrigation.amount,irrigationAgeDays:irrigation.ageDays,
    rainGaugeIn:rainGauge,soilFeel:'unknown',
    forecastRain24In:Number(context.forecastRain?.in24||0),forecastRain48In:Number(context.forecastRain?.in48||0),
    forecastRainTimingHours:Number(context.forecastRain?.firstWetHours||48),
    areaSqFt:null,irrigationHistorySupplied:irrigation.supplied,soilConfidence:soil.confidence
  });
  render(decision,setup);
  status.textContent='';
  if(scroll)result.scrollIntoView({behavior:'smooth',block:'start'});
}

function observedRainLastSevenDays(){
  const past=(context.observedHistory?.days||[]).slice(-6).reduce((sum,d)=>sum+Number(d.rainIn||0),0);
  return past+Number(context.recentRain?.todayIn||0);
}

function render(d,setup){
  const title={'WATER TODAY':'Water today','WAIT':'Wait','CHECK SOIL FIRST':'Check the soil','HOLD FOR RAIN':'Hold for rain'}[d.state];
  $('#place').textContent=locationState?.label||'Your garden';
  $('#decision').textContent=title;
  $('#amount').textContent=d.state==='WATER TODAY'
    ?`Give the garden about ${fmt(d.applyIn)} inch${d.applyIn===1?'':'es'} of water.`
    :d.state==='HOLD FOR RAIN'
      ?`Skip watering for now. About ${fmt(d.metrics.forecastRain24In)} inches of rain is forecast soon.`
      :d.state==='CHECK SOIL FIRST'
        ?'Check the soil 2–3 inches down before watering.'
        :'No watering is recommended right now.';
  $('#why').textContent=d.reason;
  $('#next-check').textContent=d.nextCheck;
  const rainShown=setup.rainGauge==null?observedRainLastSevenDays():setup.rainGauge;
  $('#recent-rain').textContent=setup.rainGauge==null?`${fmt(rainShown)} in`:`${fmt(rainShown)} in · your gauge`;
  $('#forecast-rain').textContent=`${fmt(context.forecastRain?.in24||0)} in`;
  $('#demand').textContent=d.metrics.cropEtIn?`${fmt(d.metrics.cropEtIn)} in/day`:'Low';
  $('#soil-read').textContent=setup.soil.label;

  const history=context.observedHistory||{};
  const station=history.stationName||history.station||'nearest NOAA station';
  const distance=Number.isFinite(Number(history.distanceMiles))?` · ${fmt(history.distanceMiles)} mi away`:'';
  const historyText=history.coveredDays
    ?`NOAA observed history: ${history.coveredDays}/${history.requestedDays||14} complete days · ${station}${distance}.`
    :'NOAA daily history is unavailable for this location right now; the result will not invent a historical moisture baseline.';
  $('#assumption-line').textContent=`${historyText} ${setup.irrigation.supplied?'Your recent watering is included.':'No hose or sprinkler watering was supplied.'}`;

  const recentSource=setup.rainGauge==null?(context.recentRain?.source||'NWS station observations'):'Your rain gauge';
  const sourceBits=[history.source,recentSource,context.referenceEt?.source,context.forecastRain?.source,setup.bed==='container'?'Container media profile':'USDA NRCS mapped soil'].filter(Boolean);
  $('#source-line').textContent=`${sourceBits.join(' · ')} · ${d.confidence} confidence. Historical weather is observed; root-zone moisture remains bounded rather than guessed.`;
  result.hidden=false;
  result.dataset.ready='true';
  result.dataset.state=d.state.toLowerCase().replaceAll(' ','-');
}

async function resolveAndRun(location){
  locationState=location;
  status.textContent='Replaying NOAA observed rain and weather, then checking today and the forecast…';
  context=await loadContext(location.lat,location.lon);
  localStorage.setItem('nationalGardenWaterLocationV1',JSON.stringify(location));
  runDecision();
}

locForm.addEventListener('submit',async e=>{
  e.preventDefault();status.textContent='Finding that location…';
  try{const location=await geocode($('#location').value.trim());await resolveAndRun(location);}catch(error){status.textContent=error.message||String(error);}
});

$('#use-location').addEventListener('click',()=>{
  if(!navigator.geolocation){status.textContent='Device location is not available in this browser.';return;}
  status.textContent='Getting your location…';
  navigator.geolocation.getCurrentPosition(async p=>{try{await resolveAndRun({lat:p.coords.latitude,lon:p.coords.longitude,label:'Your location'});}catch(error){status.textContent=error.message||String(error);}},()=>{status.textContent='Location permission was not granted.';},{enableHighAccuracy:false,timeout:10000});
});

$('#watered-recently').addEventListener('change',()=>{$('#irrigation-fields').hidden=!$('#watered-recently').checked;});
adjustForm.addEventListener('submit',e=>{e.preventDefault();if(!context){status.textContent='Check a location first.';return;}runDecision({scroll:false});});

(async function init(){
  $('#irrigation-date').max=new Date().toISOString().slice(0,10);
  const data=await fetch('/data/national-garden-water-crops.json').then(r=>r.json());
  crops=data.crops||[];
  const ordered=[...crops].sort((a,b)=>a.id==='generic'?-1:b.id==='generic'?1:a.name.localeCompare(b.name));
  $('#crop').innerHTML=ordered.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  $('#crop').value='generic';
  try{const saved=JSON.parse(localStorage.getItem('nationalGardenWaterLocationV1')||'null');if(saved?.label)$('#location').value=saved.label;}catch{}
})();
