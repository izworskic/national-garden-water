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

export function soilFeelDepletion(feel){
  return {wet:0.10,moist:0.25,'getting-dry':0.48,dry:0.68}[feel] ?? null;
}

export function computeDecision(input){
  const {
    crop, stage='mature', bed='ground', soil='loam', awcPerInch,
    mulch=false, referenceEtIn=0.18, fretConfidence='high',
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
  const etc=clamp(referenceEtIn*kc*bedRule.et*mulchFactor,0,0.65);
  const triggerPct=clamp(Number(crop.allowableDepletion?.[stage]||0.48),0.25,0.65);
  const trigger=taw*triggerPct;
  const observedWater=rainGaugeIn==null?Number(recentRainIn||0):Number(rainGaugeIn||0);
  const effectiveRain=clamp(observedWater*0.85,0,taw);
  const age=clamp(Number(irrigationAgeDays)||0,0,7);
  const parsedRainAge=Number(recentRainAgeHours);
  const rainAge=clamp(Number.isFinite(parsedRainAge)?parsedRainAge:72,0,72);
  const effectiveIrrigation=clamp(Math.max(0,Number(irrigationIn||0)-etc*age),0,taw);
  const feelPct=soilFeelDepletion(soilFeel);
  let depletion;
  let initialization;
  if(feelPct!=null){
    depletion=taw*feelPct;
    initialization='gardener soil-feel observation';
  }else{
    const baseline=taw*0.42 + etc*1.35;
    depletion=clamp(baseline-effectiveRain-effectiveIrrigation,0,taw);
    initialization='conservative modeled starting reserve';
  }
  // A current gardener soil-feel observation anchors present state; do not double-count older rain/irrigation against it.
  const projectedBeforeRain=clamp(depletion+etc,0,taw);
  const target=taw*0.18;
  const refillNeed=Math.max(0,projectedBeforeRain-target);
  const rainCoverage=refillNeed>0?forecastRain24In/refillNeed:1;

  let confidenceScore=100;
  if(fretConfidence==='medium')confidenceScore-=14;
  if(fretConfidence==='low')confidenceScore-=30;
  if(recentRainConfidence==='low' && rainGaugeIn==null)confidenceScore-=18;
  if(soilConfidence==='low' && bed!=='container' && awcPerInch==null)confidenceScore-=14;
  if(feelPct==null)confidenceScore-=18;
  if(!irrigationHistorySupplied)confidenceScore-=10;
  const confidence=confidenceScore>=78?'high':confidenceScore>=55?'medium':'low';

  let state='WAIT';
  const nearThreshold=projectedBeforeRain>=trigger*0.82;
  const atThreshold=projectedBeforeRain>=trigger;
  const meaningfulRain=forecastRain24In>=Math.max(0.12,refillNeed*0.72) && forecastRainTimingHours<=24;
  const strongSoonRain=forecastRainTimingHours<=12 && forecastRain24In>=Math.max(0.18,refillNeed*0.85);
  // For ordinary soil beds, a substantial recent soaking is stronger evidence than an uncertain modeled starting reserve.
  // A gardener soil-feel observation still wins, and containers stay excluded because they can dry much faster.
  const soakingRecentRain=feelPct==null && bed!=='container' && observedWater>=0.75 && (rainAge<=48 || observedWater>=1);
  if(soakingRecentRain){
    state='WAIT';
  }else if(atThreshold && (strongSoonRain || (meaningfulRain && projectedBeforeRain < trigger*1.25))){
    state='HOLD FOR RAIN';
  }else if(atThreshold){
    state='WATER TODAY';
  }else if((nearThreshold && confidence!=='high') || (confidence==='low' && projectedBeforeRain>=trigger*0.65)){
    state='CHECK SOIL FIRST';
  }
  if(projectedBeforeRain<Math.min(trigger*0.55,0.12))state='WAIT';

  let applyIn=0;
  if(state==='WATER TODAY'){
    applyIn=clamp(refillNeed,0,bedRule.cap);
    if(applyIn<0.08){ state='WAIT'; applyIn=0; }
  }
  const gallons=applyIn>0 && Number(areaSqFt)>0?gallonsFor(applyIn,Number(areaSqFt)):null;
  const reservePct=round(100*(1-projectedBeforeRain/taw),0);
  const dominant = state==='WATER TODAY'
    ? `Modeled depletion is at the ${Math.round(triggerPct*100)}% stress trigger and only ${round(forecastRain24In)} in of useful rain is expected soon.`
    : state==='HOLD FOR RAIN'
    ? `${round(forecastRain24In)} in of forecast rain is expected within about ${forecastRainTimingHours} hours and should cover most of the near-term deficit.`
    : state==='CHECK SOIL FIRST'
    ? `The model is near the watering threshold, but current root-zone moisture is not known precisely enough to justify watering from weather alone.`
    : soakingRecentRain
    ? `${round(observedWater)} in of recent rain has already supplied roughly a full garden watering. Another irrigation today would usually be unnecessary.`
    : `The modeled root-zone reserve remains above the crop's watering trigger.`;

  return {
    state, applyIn:round(applyIn), gallons, confidence,
    metrics:{
      rootZoneCapacityIn:round(taw), currentDepletionIn:round(depletion),
      projectedDepletionIn:round(projectedBeforeRain), reservePct,
      stressTriggerIn:round(trigger), referenceEtIn:round(referenceEtIn),
      cropEtIn:round(etc), recentWaterIn:round(observedWater+Number(irrigationIn||0)), effectiveRecentWaterIn:round(effectiveRain+effectiveIrrigation),
      forecastRain24In:round(forecastRain24In), forecastRain48In:round(forecastRain48In),
      recentRainAgeHours:round(rainAge,0), soakingRecentRain
    },
    assumptions:{initialization,soil:bed==='container'?'potting-media profile':soilRule.name,rootDepthIn:rootDepth,kc,bed,mulch,irrigationHistorySupplied,irrigationAgeDays:age,rainGaugeOverride:rainGaugeIn!=null},
    assumptionNote:irrigationHistorySupplied?'Recent irrigation history was supplied.':'No recent irrigation history was supplied; the model assumes 0 inches of irrigation and lowers confidence.',
    reason:dominant,
    nextCheck:soakingRecentRain?'In 1–2 days':state==='HOLD FOR RAIN'?'After the rain, or tomorrow morning':state==='WATER TODAY'?'Tomorrow morning':'Tomorrow morning'
  };
}

export function projectSevenDays({decision,crop,stage='mature',bed='ground',mulch=false,dailyReferenceEt=[],dailyForecastRain=[]}){
  const bedRule=BED[bed]||BED.ground;
  const kc=Number(crop.kc?.[stage]||1);
  const mulchFactor=mulch?0.86:1;
  let d=decision.metrics.currentDepletionIn;
  const capacity=decision.metrics.rootZoneCapacityIn;
  return Array.from({length:7},(_,i)=>{
    const eto=Number(dailyReferenceEt[i] ?? dailyReferenceEt[0] ?? decision.metrics.referenceEtIn ?? 0.18);
    const rain=Number(dailyForecastRain[i]||0);
    const etc=eto*kc*bedRule.et*mulchFactor;
    d=clamp(d+etc-rain,0,capacity);
    return {day:i,eto:round(eto),etc:round(etc),rain:round(rain),depletion:round(d),reservePct:round(100*(1-d/capacity),0)};
  });
}
