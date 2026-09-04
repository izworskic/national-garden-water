const UA='chrisizworski.com national garden water decision tool';
const MM_PER_IN=25.4;
const timeout=(ms=9000)=>AbortSignal.timeout(ms);

async function fetchText(url,opts={}){
  const r=await fetch(url,{...opts,headers:{'User-Agent':UA,'Accept':'application/json, application/xml, text/xml, */*',...(opts.headers||{})},signal:opts.signal||timeout()});
  if(!r.ok)throw new Error(`${new URL(url).hostname} HTTP ${r.status}`);
  return r.text();
}
async function fetchJson(url,opts={}){return JSON.parse(await fetchText(url,opts));}
const inches=mm=>Number(mm||0)/MM_PER_IN;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

function parseDurationHours(validTime=''){
  const [,dur='PT0H']=validTime.split('/');
  const d=/P(?:(\d+)D)?T?(?:(\d+)H)?/.exec(dur)||[];
  return Number(d[1]||0)*24+Number(d[2]||0);
}
function startMs(validTime=''){return Date.parse(validTime.split('/')[0]);}
export function aggregateQpf(values=[],now=Date.now()){
  const daily=Array(7).fill(0), horizon24=now+24*3600e3,horizon48=now+48*3600e3;
  let r24=0,r48=0, firstWetHours=null;
  for(const item of values){
    const t=startMs(item.validTime); if(!Number.isFinite(t)||t<now-3600e3)continue;
    const v=inches(item.value); if(v<=0)continue;
    const idx=Math.floor((t-now)/(24*3600e3)); if(idx>=0&&idx<7)daily[idx]+=v;
    if(t<=horizon24)r24+=v;
    if(t<=horizon48)r48+=v;
    if(firstWetHours==null)firstWetHours=Math.max(0,Math.round((t-now)/3600e3));
  }
  return {rain24:clamp(r24,0,10),rain48:clamp(r48,0,15),daily:daily.map(x=>Number(x.toFixed(3))),firstWetHours:firstWetHours??48};
}

export function parseFretXml(xml){
  const sections=[...xml.matchAll(/<evapotranspiration\b[^>]*>([\s\S]*?)<\/evapotranspiration>/gi)].map(m=>m[1]);
  const parsed=[];
  for(const body of sections){
    const name=(body.match(/<name>([\s\S]*?)<\/name>/i)?.[1]||'').replace(/<[^>]+>/g,'').trim();
    const vals=[...body.matchAll(/<value(?:\s[^>]*)?>([^<]*)<\/value>/gi)].map(m=>m[1].trim()).filter(Boolean).map(Number).filter(Number.isFinite);
    parsed.push({name,values:vals});
  }
  const daily=parsed.find(x=>/Daily Reference Crop Evapotranspiration/i.test(x.name) && !/Departure/i.test(x.name));
  const weekly=parsed.find(x=>/Weekly Reference Crop Evapotranspiration/i.test(x.name));
  return {daily:daily?.values||[],weekly:weekly?.values?.[0]??null};
}

async function getFret(lat,lon){
  const begin=new Date().toISOString().slice(0,10);
  const url=`https://digital.weather.gov/xml/sample_products/browser_interface/ndfdXMLclient.php?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&product=time-series&begin=${begin}&Unit=e&evp24=evp24&evp168=evp168`;
  try{
    const xml=await fetchText(url,{signal:timeout(10000)});
    const p=parseFretXml(xml);
    if(p.daily.length){return {daily:p.daily.slice(0,7),weekly:p.weekly,confidence:'high',source:'NWS NDFD FRET',freshness:'current forecast'};}
    throw new Error('FRET values absent');
  }catch(error){return {daily:[],weekly:null,confidence:'low',source:'NWS NDFD FRET unavailable',error:String(error.message||error)};}
}

function extraterrestrialRadiation(latDeg,date=new Date()){
  const phi=latDeg*Math.PI/180;
  const start=new Date(Date.UTC(date.getUTCFullYear(),0,0));
  const j=Math.floor((date-start)/86400000);
  const dr=1+0.033*Math.cos(2*Math.PI*j/365);
  const delta=0.409*Math.sin(2*Math.PI*j/365-1.39);
  const ws=Math.acos(Math.max(-1,Math.min(1,-Math.tan(phi)*Math.tan(delta))));
  return (24*60/Math.PI)*0.0820*dr*(ws*Math.sin(phi)*Math.sin(delta)+Math.cos(phi)*Math.cos(delta)*Math.sin(ws));
}
function firstValue(prop){return prop?.values?.find(v=>Number.isFinite(Number(v.value)))?.value;}
function hargreavesFallback(grid,lat){
  const tmax=Number(firstValue(grid.maxTemperature)),tmin=Number(firstValue(grid.minTemperature));
  if(!Number.isFinite(tmax)||!Number.isFinite(tmin)||tmax<tmin)return null;
  const mean=(tmax+tmin)/2,ra=extraterrestrialRadiation(Number(lat));
  const mm=Math.max(0,0.0023*(mean+17.8)*Math.sqrt(Math.max(0.1,tmax-tmin))*ra);
  return Number((mm/MM_PER_IN).toFixed(3));
}

export function parseSdaTable(data){
  const table=data?.Table; if(!Array.isArray(table)||table.length<2)return [];
  const heads=table[0]; return table.slice(1).map(row=>Object.fromEntries(heads.map((h,i)=>[h,row[i]])));
}
function textureFromRow(r){
  const sand=Number(r.sandtotal_r),silt=Number(r.silttotal_r),clay=Number(r.claytotal_r);
  if(![sand,silt,clay].every(Number.isFinite))return 'loam';
  if(sand>=70)return 'sand'; if(sand>=52&&clay<20)return 'sandy-loam';
  if(clay>=40)return 'clay'; if(clay>=27)return 'clay-loam'; if(silt>=50)return 'silt-loam'; return 'loam';
}
async function getSoil(lat,lon){
  const point=`point(${Number(lon).toFixed(5)} ${Number(lat).toFixed(5)})`;
  const sql=`SELECT TOP 12 mu.mukey, mu.muname, c.compname, c.comppct_r, ch.hzdept_r, ch.hzdepb_r, ch.awc_r, ch.sandtotal_r, ch.silttotal_r, ch.claytotal_r FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${point}') p JOIN mapunit mu ON mu.mukey=p.mukey JOIN component c ON c.mukey=mu.mukey JOIN chorizon ch ON ch.cokey=c.cokey WHERE c.majcompflag='Yes' ORDER BY c.comppct_r DESC, ch.hzdept_r ASC`;
  try{
    const text=await fetchText('https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:sql,format:'JSON+COLUMNNAME'}),signal:timeout(12000)});
    const rows=parseSdaTable(JSON.parse(text)); if(!rows.length)throw new Error('no mapped soil rows');
    const topComp=rows[0].compname; const horizons=rows.filter(r=>r.compname===topComp && Number(r.hzdept_r)<24);
    let weighted=0,depth=0;
    for(const r of horizons){const a=Math.max(0,Number(r.hzdept_r)||0),b=Math.min(24,Number(r.hzdepb_r)||0),w=Math.max(0,b-a),awc=Number(r.awc_r);if(w&&Number.isFinite(awc)){weighted+=awc*w;depth+=w;}}
    const awc=depth?clamp(weighted/depth,0.04,0.24):null;
    return {texture:textureFromRow(rows[0]),awcPerInch:awc,mapUnitName:rows[0].muname,component:topComp,confidence:awc?'medium':'low',source:'USDA NRCS Soil Data Access'};
  }catch(error){return {texture:null,awcPerInch:null,mapUnitName:null,component:null,confidence:'low',source:'USDA NRCS Soil Data Access unavailable',error:String(error.message||error)};}
}

export function summarizeStationRain(obs,now=Date.now(),station=null,rank=0){
  const byHour=new Map();
  let latestWetAt=null;
  for(const f of obs?.features||[]){
    const t=Date.parse(f.properties?.timestamp);
    const mm=Number(f.properties?.precipitationLastHour?.value);
    if(!Number.isFinite(t)||!Number.isFinite(mm)||mm<0)continue;
    const k=Math.floor(t/3600e3);
    byHour.set(k,Math.max(byHour.get(k)||0,mm));
    if(mm>0 && (latestWetAt==null||t>latestWetAt))latestWetAt=t;
  }
  const total=[...byHour.values()].reduce((a,b)=>a+b,0);
  const coverage=byHour.size/72;
  return {
    inches:Number(inches(total).toFixed(3)),coverage:Number(coverage.toFixed(2)),station,rank,
    latestWetAt:latestWetAt==null?null:new Date(latestWetAt).toISOString(),
    latestWetHoursAgo:latestWetAt==null?72:Math.max(0,Math.min(72,Math.round((now-latestWetAt)/3600e3)))
  };
}

async function recentObservedRain(points,now=Date.now()){
  try{
    const stationUrl=points?.properties?.observationStations; if(!stationUrl)throw new Error('no observation stations URL');
    const stations=await fetchJson(stationUrl,{signal:timeout(7000)});
    const candidates=(stations.features||[]).slice(0,4).map((f,rank)=>({station:f.id,rank})).filter(x=>x.station);
    if(!candidates.length)throw new Error('no stations');
    const start=new Date(now-72*3600e3).toISOString(); const end=new Date(now).toISOString();
    const settled=await Promise.allSettled(candidates.map(async x=>{
      const obs=await fetchJson(`${x.station}/observations?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,{signal:timeout(9000)});
      return summarizeStationRain(obs,now,x.station,x.rank);
    }));
    const summaries=settled.filter(x=>x.status==='fulfilled').map(x=>x.value);
    if(!summaries.length)throw new Error('nearby observation stations unavailable');
    const adequate=summaries.filter(x=>x.coverage>=0.45).sort((a,b)=>a.rank-b.rank);
    let chosen=adequate[0]||[...summaries].sort((a,b)=>b.coverage-a.coverage||a.rank-b.rank)[0];
    // If the chosen station has sparse hourly reporting, require corroboration from at least two nearby stations before
    // using a larger regional rain total. This avoids treating a single distant thunderstorm report as the user's rain.
    if(chosen.coverage<0.45){
      const supported=summaries.filter(x=>x.coverage>=0.25).sort((a,b)=>b.inches-a.inches);
      const regionalFloor=supported.length>=2?supported[1].inches:0;
      if(regionalFloor>=0.5 && regionalFloor>chosen.inches){
        const wet=supported.find(x=>x.inches>=regionalFloor&&x.latestWetAt);
        chosen={...chosen,inches:Number(regionalFloor.toFixed(3)),regionalEstimate:true,latestWetAt:wet?.latestWetAt||chosen.latestWetAt,latestWetHoursAgo:wet?.latestWetHoursAgo??chosen.latestWetHoursAgo};
      }
    }
    return {
      inches:chosen.inches,confidence:chosen.coverage>=0.7?'medium':'low',coverage:chosen.coverage,
      station:chosen.station,stationCount:summaries.length,latestWetAt:chosen.latestWetAt,latestWetHoursAgo:chosen.latestWetHoursAgo,
      regionalEstimate:Boolean(chosen.regionalEstimate),
      source:chosen.rank===0&&!chosen.regionalEstimate?'NWS station observations':'NWS nearby station observations'
    };
  }catch(error){return {inches:0,confidence:'low',coverage:0,station:null,stationCount:0,latestWetAt:null,latestWetHoursAgo:72,regionalEstimate:false,source:'NWS station observations unavailable',error:String(error.message||error)};}
}

export async function buildContext(lat,lon){
  const points=await fetchJson(`https://api.weather.gov/points/${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`,{signal:timeout(9000)});
  const grid=await fetchJson(points.properties.forecastGridData,{signal:timeout(9000)});
  const qpf=aggregateQpf(grid.properties?.quantitativePrecipitation?.values||[]);
  const [fret,soil,recentRain]=await Promise.all([getFret(lat,lon),getSoil(lat,lon),recentObservedRain(points)]);
  let dailyEt=fret.daily, fretConfidence=fret.confidence, fretSource=fret.source;
  if(!dailyEt.length){const fb=hargreavesFallback(grid.properties,lat);if(fb!=null){dailyEt=Array(7).fill(fb);fretConfidence='medium';fretSource='NWS forecast temperatures + FAO Hargreaves fallback';}}
  return {
    location:{lat:Number(lat),lon:Number(lon),wfo:points.properties?.gridId||null},
    referenceEt:{daily:dailyEt,weekly:fret.weekly,confidence:fretConfidence,source:fretSource,error:fret.error||null},
    forecastRain:{in24:qpf.rain24,in48:qpf.rain48,daily:qpf.daily,firstWetHours:qpf.firstWetHours,source:'NWS quantitative precipitation forecast'},
    recentRain,soil,
    generatedAt:new Date().toISOString()
  };
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=1800');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method==='GET' && req.query?.health==='1')return res.status(200).json({ok:true,service:'national-garden-water'});
  const lat=Number(req.query?.lat),lon=Number(req.query?.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return res.status(400).json({error:'Valid lat and lon are required.'});
  try{return res.status(200).json(await buildContext(lat,lon));}
  catch(error){return res.status(502).json({error:'Garden water context is temporarily unavailable.',detail:String(error.message||error)});}
}
