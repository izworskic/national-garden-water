export const SOILS = {
  sand: {name:'Sand', awcPerInch:0.06},
  'sandy-loam': {name:'Sandy loam', awcPerInch:0.11},
  loam: {name:'Loam', awcPerInch:0.16},
  'silt-loam': {name:'Silt loam', awcPerInch:0.19},
  'clay-loam': {name:'Clay loam', awcPerInch:0.18},
  clay: {name:'Clay', awcPerInch:0.16},
  'potting-mix': {name:'Potting mix', awcPerInch:0.15}
};

export const BED = {
  ground: {reservoir:1, et:1, cap:0.75},
  raised: {reservoir:0.86, et:1.08, cap:0.60},
  container: {reservoir:0.62, et:1.18, cap:0.40}
};

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const round=(n,d=2)=>Number(n.toFixed(d));
export const gallonsFor=(inches,sqft)=>round(inches*sqft*0.623,2);

function ymdInZone(ms,timeZone='UTC'){
  try{
    const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
    const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }catch{return new Date(ms).toISOString().slice(0,10);}
}
function shiftYmd(ymd,days){const d=new Date(`${ymd}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}

export function selectRecentObservedRain({
  historyDays=[],todayRainIn=0,stationRainIn=0,stationCoverage=0,stationRainAgeHours=72,
  generatedAt=Date.now(),timeZone='UTC'
}={}){
  const now=Number.isFinite(Number(generatedAt))?Number(generatedAt):Date.parse(generatedAt);
  const today=ymdInZone(Number.isFinite(now)?now:Date.now(),timeZone);
  const start=shiftYmd(today,-3),end=shiftYmd(today,-1);
  const recentDays=(historyDays||[]).filter(day=>{
    const date=String(day?.date||'').slice(0,10);
    return date>=start&&date<=end&&Number.isFinite(Number(day?.rainIn));
  });
  const completeDays=new Set(recentDays.map(day=>String(day.date).slice(0,10))).size;
  const dailyTotal=recentDays.reduce((sum,day)=>sum+Math.max(0,Number(day.rainIn)||0),0)+Math.max(0,Number(todayRainIn)||0);
  const stationTotal=Math.max(0,Number(stationRainIn)||0);
  const coverage=clamp(Number(stationCoverage)||0,0,1);
  const age=clamp(Number.isFinite(Number(stationRainAgeHours))?Number(stationRainAgeHours):72,0,72);

  if(coverage>=0.70){
    return {inches:round(stationTotal,3),confidence:'medium',ageHours:age,source:'NWS hourly station observations',dailyDays:completeDays,stationCoverage:round(coverage,2)};
  }
  if(completeDays>=2){
    return {inches:round(dailyTotal,3),confidence:completeDays>=3?'medium':'low',ageHours:72,source:'NOAA daily summaries + NWS today',dailyDays:completeDays,stationCoverage:round(coverage,2)};
  }
  if(coverage>0 || stationTotal>0){
    return {inches:round(stationTotal,3),confidence:'low',ageHours:age,source:'NWS hourly station observations',dailyDays:completeDays,stationCoverage:round(coverage,2)};
  }
  return {inches:round(dailyTotal,3),confidence:'low',ageHours:72,source:'NOAA daily summaries',dailyDays:completeDays,stationCoverage:round(coverage,2)};
}

export function soilFeelDepletion(feel){
  return {wet:0.10,moist:0.25,'getting-dry':0.48,dry:0.68}[feel] ?? null;
}

export function replayObservedWaterBalance({
  days=[],capacityIn,crop,stage='mature',bed='ground',mulch=false,
  todayReferenceEtIn=0,todayRainIn=0,recentRainIn=0,rainGaugeIn=null,
  irrigationIn=0,irrigationAgeDays=0
}){
  const bedRule=BED[bed]||BED.ground;
  const kc=Number(crop?.kc?.[stage]||1);
  const mulchFactor=mulch?0.86:1;
  const capacity=clamp(Number(capacityIn)||0.25,0.25,4.5);
  let minDepletion=0;
  let maxDepletion=capacity;
  let observedRain=0;
  let observedCropEt=0;
  let daysUsed=0;
  const daily=[];

  const ordered=[...days].filter(Boolean).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  for(const day of ordered){
    const eto=Number(day.referenceEtIn);
    const rain=Math.max(0,Number(day.rainIn)||0);
    if(!Number.isFinite(eto) && !Number.isFinite(Number(day.rainIn))) continue;
    const etc=clamp((Number.isFinite(eto)?eto:0)*kc*bedRule.et*mulchFactor,0,0.65);
    const effectiveRain=clamp(rain*0.85,0,capacity);
    minDepletion=clamp(minDepletion+etc-effectiveRain,0,capacity);
    maxDepletion=clamp(maxDepletion+etc-effectiveRain,0,capacity);
    observedRain+=rain;
    observedCropEt+=etc;
    daysUsed++;
    daily.push({date:day.date||null,rainIn:round(rain),cropEtIn:round(etc),minDepletionIn:round(minDepletion),maxDepletionIn:round(maxDepletion)});
  }

  const todayEt=clamp(Math.max(0,Number(todayReferenceEtIn)||0)*kc*bedRule.et*mulchFactor,0,0.65);
  const todayRain=Math.max(0,Number(todayRainIn)||0);
  minDepletion=clamp(minDepletion+todayEt-todayRain*0.85,0,capacity);
  maxDepletion=clamp(maxDepletion+todayEt-todayRain*0.85,0,capacity);

  if(rainGaugeIn!=null){
    const delta=Number(rainGaugeIn)-Math.max(0,Number(recentRainIn)||0);
    minDepletion=clamp(minDepletion-delta*0.85,0,capacity);
    maxDepletion=clamp(maxDepletion-delta*0.85,0,capacity);
  }

  const age=clamp(Number(irrigationAgeDays)||0,0,7);
  if(Number(irrigationIn)>0){
    const recentEt=[...daily.map(x=>x.cropEtIn),todayEt].slice(-(Math.max(0,Math.floor(age))+1)).reduce((a,b)=>a+Number(b||0),0);
    const remaining=Math.max(0,Number(irrigationIn)-recentEt);
    minDepletion=clamp(minDepletion-remaining,0,capacity);
    maxDepletion=clamp(maxDepletion-remaining,0,capacity);
  }

  return {
    minDepletionIn:round(minDepletion),maxDepletionIn:round(maxDepletion),
    observedRainIn:round(observedRain+todayRain),observedCropEtIn:round(observedCropEt+todayEt),
    todayCropEtIn:round(todayEt),daysUsed,daily
  };
}

export function computeDecision(input){
  const {
    crop, stage='mature', bed='ground', soil='loam', awcPerInch,
    mulch=false, referenceEtIn=0, fretConfidence='high',
    observedHistoryDays=[], historyConfidence='low', currentObservedRainIn=0,
    recentRainIn=0, recentRainConfidence='medium', recentRainAgeHours=72, irrigationIn=0,
    rainGaugeIn=null, soilFeel='unknown', irrigationAgeDays=0, forecastRain24In=0,
    forecastRain48In=0, forecastRainTimingHours=24, areaSqFt=null,
    irrigationHistorySupplied=false, soilConfidence='medium'
  }=input;
  if(!crop) throw new Error('crop profile required');
  const bedRule=BED[bed]||BED.ground;
  const soilRule=bed==='container'?SOILS['potting-mix']:(SOILS[soil]||SOILS.loam);
  const effectiveAwc=bed==='container' ? soilRule.awcPerInch : clamp(Number(awcPerInch)||soilRule.awcPerInch,0.04,0.24);
  let rootDepth=Number(crop.rootDepthIn?.[stage]||12);
  if(bed==='container') rootDepth=Math.min(rootDepth,12);
  const taw=clamp(effectiveAwc*rootDepth*bedRule.reservoir,0.25,4.5);
  const kc=Number(crop.kc?.[stage]||1);
  const mulchFactor=mulch?0.86:1;
  const etc=clamp(Math.max(0,Number(referenceEtIn)||0)*kc*bedRule.et*mulchFactor,0,0.65);
  const triggerPct=clamp(Number(crop.allowableDepletion?.[stage]||0.48),0.25,0.65);
  const trigger=taw*triggerPct;
  const target=taw*0.18;
  const observedWater=rainGaugeIn==null?Number(recentRainIn||0):Number(rainGaugeIn||0);
  const parsedRainAge=Number(recentRainAgeHours);
  const rainAge=clamp(Number.isFinite(parsedRainAge)?parsedRainAge:72,0,72);
  const feelPct=soilFeelDepletion(soilFeel);

  const ledger=replayObservedWaterBalance({
    days:observedHistoryDays,capacityIn:taw,crop,stage,bed,mulch,
    todayReferenceEtIn:referenceEtIn,todayRainIn:currentObservedRainIn,
    recentRainIn,rainGaugeIn,irrigationIn,irrigationAgeDays
  });

  let minDepletion=ledger.minDepletionIn;
  let maxDepletion=ledger.maxDepletionIn;
  let initialization='NOAA/NWS observed-weather uncertainty range';
  if(feelPct!=null){
    minDepletion=maxDepletion=taw*feelPct;
    initialization='gardener soil-feel observation';
  }

  let confidenceScore=100;
  if(historyConfidence==='medium')confidenceScore-=12;
  if(historyConfidence==='low')confidenceScore-=30;
  if(fretConfidence==='medium')confidenceScore-=8;
  if(fretConfidence==='low')confidenceScore-=18;
  if(recentRainConfidence==='low' && rainGaugeIn==null)confidenceScore-=10;
  if(soilConfidence==='low' && bed!=='container' && awcPerInch==null)confidenceScore-=12;
  if(!irrigationHistorySupplied)confidenceScore-=8;
  const confidence=confidenceScore>=80?'high':confidenceScore>=58?'medium':'low';

  const soakingRecentRain=feelPct==null && bed!=='container' && observedWater>=0.75 && (rainAge<=48 || observedWater>=1);
  const definitelyDry=minDepletion>=trigger;
  const definitelyWet=historyConfidence!=='low' && maxDepletion<trigger*0.90;
  const refillNeedMin=Math.max(0,minDepletion-target);
  const refillNeedMax=Math.max(0,maxDepletion-target);
  const meaningfulRain=forecastRain24In>=Math.max(0.12,refillNeedMin*0.72) && forecastRainTimingHours<=24;
  const strongSoonRain=forecastRainTimingHours<=12 && forecastRain24In>=Math.max(0.18,refillNeedMin*0.85);

  let state='CHECK SOIL FIRST';
  if(soakingRecentRain){
    state='WAIT';
  }else if(definitelyDry && (strongSoonRain || meaningfulRain)){
    state='HOLD FOR RAIN';
  }else if(definitelyDry){
    state='WATER TODAY';
  }else if(definitelyWet){
    state='WAIT';
  }else if(forecastRainTimingHours<=12 && forecastRain24In>=Math.max(0.25,refillNeedMax*0.65)){
    state='HOLD FOR RAIN';
  }

  let applyIn=0;
  if(state==='WATER TODAY'){
    applyIn=clamp(refillNeedMin,0,bedRule.cap);
    if(applyIn<0.08){state='WAIT';applyIn=0;}
  }
  const gallons=applyIn>0 && Number(areaSqFt)>0?gallonsFor(applyIn,Number(areaSqFt)):null;
  const reserveBestPct=round(100*(1-minDepletion/taw),0);
  const reserveWorstPct=round(100*(1-maxDepletion/taw),0);

  const historyLabel=ledger.daysUsed===1?'1 observed day':`${ledger.daysUsed} observed days`;
  const dominant = state==='WATER TODAY'
    ? `Observed weather has dried even the wettest plausible root-zone condition to the crop's watering trigger.`
    : state==='HOLD FOR RAIN'
    ? `${round(forecastRain24In)} in of NWS forecast rain is expected soon, so watering now would get ahead of likely incoming water.`
    : state==='CHECK SOIL FIRST'
    ? `Observed weather still allows both a wet-enough and a dry-enough root zone. Check the soil 2–3 inches down before watering.`
    : soakingRecentRain
    ? `${round(observedWater)} in of recent observed rain has already supplied roughly a full garden watering. Another irrigation today would usually be unnecessary.`
    : `After replaying ${historyLabel} of observed weather, even the driest plausible root-zone path remains short of the crop's watering trigger.`;

  return {
    state,applyIn:round(applyIn),gallons,confidence,
    metrics:{
      rootZoneCapacityIn:round(taw),minDepletionIn:round(minDepletion),maxDepletionIn:round(maxDepletion),
      reserveBestPct,reserveWorstPct,stressTriggerIn:round(trigger),referenceEtIn:round(referenceEtIn),
      cropEtIn:round(etc),observedHistoryRainIn:ledger.observedRainIn,observedHistoryCropEtIn:ledger.observedCropEtIn,
      observedHistoryDays:ledger.daysUsed,recentWaterIn:round(observedWater+Number(irrigationIn||0)),
      forecastRain24In:round(forecastRain24In),forecastRain48In:round(forecastRain48In),
      recentRainAgeHours:round(rainAge,0),soakingRecentRain
    },
    assumptions:{initialization,soil:bed==='container'?'potting-media profile':soilRule.name,rootDepthIn:rootDepth,kc,bed,mulch,irrigationHistorySupplied,irrigationAgeDays:clamp(Number(irrigationAgeDays)||0,0,7),rainGaugeOverride:rainGaugeIn!=null},
    assumptionNote:irrigationHistorySupplied?'Your reported irrigation is replayed against observed recent drying.':'No hose or sprinkler watering was supplied; the weather ledger therefore assumes none and says so explicitly.',
    reason:dominant,
    nextCheck:soakingRecentRain?'In 1–2 days':state==='HOLD FOR RAIN'?'After the rain, or tomorrow morning':state==='WATER TODAY'?'Tomorrow morning':state==='CHECK SOIL FIRST'?'Now, before watering':'Tomorrow morning'
  };
}

export function projectSevenDays({decision,crop,stage='mature',bed='ground',mulch=false,dailyReferenceEt=[],dailyForecastRain=[]}){
  const bedRule=BED[bed]||BED.ground;
  const kc=Number(crop.kc?.[stage]||1);
  const mulchFactor=mulch?0.86:1;
  let minD=Number(decision.metrics.minDepletionIn??0);
  let maxD=Number(decision.metrics.maxDepletionIn??minD);
  const capacity=decision.metrics.rootZoneCapacityIn;
  return Array.from({length:7},(_,i)=>{
    const eto=Number(dailyReferenceEt[i] ?? dailyReferenceEt[0] ?? decision.metrics.referenceEtIn ?? 0);
    const rain=Number(dailyForecastRain[i]||0);
    const etc=eto*kc*bedRule.et*mulchFactor;
    minD=clamp(minD+etc-rain*0.85,0,capacity);
    maxD=clamp(maxD+etc-rain*0.85,0,capacity);
    return {day:i,eto:round(eto),etc:round(etc),rain:round(rain),minDepletion:round(minD),maxDepletion:round(maxD),reserveBestPct:round(100*(1-minD/capacity),0),reserveWorstPct:round(100*(1-maxD/capacity),0)};
  });
}
