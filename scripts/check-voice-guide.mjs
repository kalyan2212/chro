import {chromium} from 'playwright-core';
import {createServer} from '../server.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const server=createServer({apiKey:'',fetchImpl:()=>{throw Error('No provider calls');}});await server.ready;await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHRO_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.waitForFunction(()=>window.WI_VOICE_GUIDE);
const response=await page.request.post(base+'/api/ask',{data:{question:'Model retention with 0.5 pp reduction',scope:{function:'all',region:'all',period:'quarter'}}});assert.equal(response.status(),200);const data=await response.json();assert.ok(data.facts.length);
await page.evaluate(async data=>{await window.WI_CONVERSATION.showResponse(data);window.WI_VOICE_GUIDE.prepare(data);},data);await page.waitForTimeout(700);
assert.equal(await page.locator('#voice-guide').isVisible(),true);assert.ok(await page.locator('.vg-spotlight').count());
const i=Math.min(1,data.facts.length-1);await page.evaluate(label=>window.WI_VOICE_GUIDE.speak(label),data.facts[i].label);assert.match(await page.locator('.vg-fact[aria-current=true]').innerText(),new RegExp(data.facts[i].label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
await page.waitForTimeout(350);await mkdir('docs/narration',{recursive:true});await page.screenshot({path:'docs/narration/voice-guide-desktop.png'});
await page.evaluate(()=>window.WI_VOICE_GUIDE.stop());assert.equal(await page.locator('#voice-guide').isVisible(),false);assert.equal(await page.locator('.vg-spotlight').count(),0);
await page.evaluate(data=>{window.WI_VOICE_GUIDE.prepare(data);window.WI_VOICE_GUIDE.stop();},data);await page.waitForTimeout(250);assert.equal(await page.locator('.vg-spotlight').count(),0);
await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(data=>window.WI_VOICE_GUIDE.prepare(data),data);await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'docs/narration/voice-guide-mobile.png'});
assert.equal(await page.locator('.vg-status').evaluate(el=>getComputedStyle(el,'::before').animationName),'none');await page.getByRole('button',{name:'Hide guide',exact:true}).click();assert.equal(await page.locator('#voice-guide').isVisible(),false);assert.deepEqual(errors,[]);console.log('PASS: validated evidence, transcript focus, stop/cancel cleanup, mobile layout, reduced motion; no provider or physical audio test.');
}finally{await browser.close();await new Promise(r=>server.close(r));await server.whenClosed();}
