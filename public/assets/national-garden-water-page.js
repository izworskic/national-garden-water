import {computeDecision,selectRecentObservedRain,SOILS} from './national-garden-water-engine.js?v=20260904-v5';

const $=s=>document.querySelector(s);
const fmt=n=>Number(n||0).toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
let crops=[];
let locationState=null;
let context=null;
let recentRainSignal=null;
let locationRevision=0;

const locForm=$('#location-form');
const adjustForm=$('#adjust-form');
const status=$('.status');
const result=$('#result');
function beginLocation(){
  const ticket=++locationRevision;
  locationState=null;context=null;recentRainSignal=null;
  result.hidden=true;delete result.dataset.ready;delete result.dataset.state;
  return ticket;
}
function currentLocation(ticket){return ticket===locationRevision;}
function locationError(ticket,error){if(currentLocation(ticket))status.textContent=error.message||String(error);}

async function geocode(q){
  const r=await fetch(`/api/national-geocode?q=${encodeURIComponent(q)}`);
  const d=await r.json();
  if(!r.ok)throw new Error(d.error||'Location lookup failed');
  const lat=Number(d.latitude),lon=Number(d.longitude);
  if(d.latitude==null||d.longitude==null||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Error('Location did not resolve');
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

function buildRecentRainSignal(){
  return selectRecentObservedRain({
    historyDays:context?.observedHistory?.days||[],
    todayRainIn:Number(context?.recentRain?.todayIn||0),
    stationRainIn:Number(context?.recentRain?.inches||0),
    stationCoverage:Number(context?.recentRain?.coverage||0),
    stationRainAgeHours:Number(context?.recentRain?.latestWetHoursAgo??72),
    generatedAt:context?.generatedAt||Date.now(),
    timeZone:context?.location?.timeZone||'UTC'
  });
}

function runDecision({scroll=true}={}){
  if(!context)return;
  let setup;
  try{setup=currentSetup();}catch(error){status.textContent=error.message;return;}
  const {bed,crop,soil,irrigation,rainGauge,stage}=setup;
  const eto=Number(context.referenceEt?.daily?.[0]||0);
  recentRainSignal=buildRecentRainSignal();
  const decision=computeDecision({
    crop,stage,bed,soil:soil.id,awcPerInch:soil.awc,mulch:false,
    referenceEtIn:eto,fretConfidence:context.referenceEt?.confidence||'low',
    observedHistoryDays:context.observedHistory?.days||[],historyConfidence:context.observedHistory?.confidence||'low',
    currentObservedRainIn:Number(context.recentRain?.todayIn||0),
    recentRainIn:recentRainSignal.inches,recentRainConfidence:recentRainSignal.confidence,
    recentRainAgeHours:recentRainSignal.ageHours,
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

function render(d,setup){
  const title={'WATER TODAY':'Water today','WAIT':"Don't water today",'CHECK SOIL FIRST':'Check soil first','HOLD FOR RAIN':'Hold for rain'}[d.state];
  $('#place').textContent=locationState?.label||'Your garden';
  $('#decision').textContent=title;
  $('#amount').textContent=d.state==='WATER TODAY'
    ?`Give the garden about ${fmt(d.applyIn)} inch${d.applyIn===1?'':'es'} of water.`
    :d.state==='HOLD FOR RAIN'
      ?`Skip watering for now. About ${fmt(d.metrics.forecastRain24In)} inches of rain is forecast soon.`
      :d.state==='CHECK SOIL FIRST'
        ?'Check the soil 2–3 inches down before watering.'
        :'Let the garden use the water already in the root zone.';
  $('#why').textContent=d.reason;
  $('#next-check').textContent=d.nextCheck;

  const rainShown=setup.rainGauge==null?recentRainSignal.inches:setup.rainGauge;
  $('#recent-rain').textContent=`${fmt(rainShown)} in`;
  $('#recent-rain-source').textContent=setup.rainGauge==null?recentRainSignal.source:'Your rain gauge';
  $('#forecast-rain').textContent=`${fmt(context.forecastRain?.in24||0)} in`;
  $('#demand').textContent=d.metrics.cropEtIn?`${fmt(d.metrics.cropEtIn)} in/day`:'Low';
  $('#soil-read').textContent=setup.soil.label;

  const history=context.observedHistory||{};
  const station=history.stationName||history.station||'nearest NOAA station';
  const distance=Number.isFinite(Number(history.distanceMiles))?` · ${fmt(history.distanceMiles)} mi away`:'';
  const historyText=history.coveredDays
    ?`Observed weather ledger: ${history.coveredDays}/${history.requestedDays||14} complete NOAA days · ${station}${distance}.`
    :'NOAA daily history is incomplete here, so the tool will not invent a starting soil-moisture value.';
  $('#assumption-line').textContent=`${historyText} ${setup.irrigation.supplied?'Your recent watering is included.':'No hose or sprinkler watering was supplied.'}`;

  const sourceBits=[setup.rainGauge==null?recentRainSignal.source:'Your rain gauge',context.referenceEt?.source,context.forecastRain?.source,setup.bed==='container'?'Container media profile':'USDA NRCS mapped soil'].filter(Boolean);
  $('#source-line').textContent=`${sourceBits.join(' · ')} · ${d.confidence} confidence. Root-zone moisture is modeled as a range, not claimed as a sensor reading.`;
  result.hidden=false;
  result.dataset.ready='true';
  result.dataset.state=d.state.toLowerCase().replaceAll(' ','-');
}

async function resolveAndRun(location,ticket){
  if(!currentLocation(ticket))return;
  status.textContent='Checking recent rain, drying, soil and the next forecast…';
  const fresh=await loadContext(location.lat,location.lon);
  if(!currentLocation(ticket))return;
  // Location and its evidence are committed together, never independently.
  locationState=location;context=fresh;
  try{localStorage.setItem('nationalGardenWaterLocationV1',JSON.stringify(location));}catch{}
  runDecision();
}

locForm.addEventListener('submit',async e=>{
  e.preventDefault();const ticket=beginLocation();status.textContent='Finding that location…';
  try{const location=await geocode($('#location').value.trim());await resolveAndRun(location,ticket);}catch(error){locationError(ticket,error);}
});

$('#use-location').addEventListener('click',()=>{
  const ticket=beginLocation();
  if(!navigator.geolocation){status.textContent='Device location is not available in this browser.';return;}
  status.textContent='Getting your location…';
  navigator.geolocation.getCurrentPosition(async p=>{try{await resolveAndRun({lat:p.coords.latitude,lon:p.coords.longitude,label:'Your location'},ticket);}catch(error){locationError(ticket,error);}},()=>{if(currentLocation(ticket))status.textContent='Location permission was not granted.';},{enableHighAccuracy:false,timeout:10000});
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
