import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync("public/assets/national-garden-water-page.js",'utf8');
test('A new lookup retires prior decision before awaiting the location and ignores superseded decision responses',()=>{
 assert.match(source,/function beginLookup\(\)[\s\S]*?context=null;locationState=null;recentRainSignal=null;[\s\S]*?result.hidden=true/);
 assert.match(source,/const next=await loadContext[\s\S]*?if\(ticket!==locationGeneration\)return;[\s\S]*?context=next/);
});
