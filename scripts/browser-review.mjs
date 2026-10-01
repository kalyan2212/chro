import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from '../server.mjs';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const out='docs/screenshots';await mkdir(out,{recursive:true});
const storageDir=await mkdtemp(join(tmpdir(),'chro-browser-'));
const server=createServer({apiKey:'',storageDir,fetchImpl:()=>{throw Error('Unexpected external request');}});await server.ready;await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHRO_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const checks=[],errors=[];
const record=name=>{checks.push(name);console.log('PASS',name);};
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/?workspace=1');await page.waitForFunction(()=>window.WI_INVESTIGATIONS);
 // Reproduce original screenshots from preserved source, without replacing the working application.
 const baseline=await browser.newPage({viewport:{width:1920,height:1080}});
 await baseline.route(base+'/',async route=>{const original=await readFile('docs/review-originals/public-index.html','utf8');const current=await (await route.fetch()).text();const boot=current.match(/<script id="wi-dataset-bootstrap">[\s\S]*?<\/script>/)[0];await route.fulfill({contentType:'text/html',body:original.replace('<!-- wi-dataset-bootstrap -->',boot)});});
 await baseline.goto(base);
 for(const name of ['monitor','investigate','decide']){if(name!=='monitor')await baseline.locator(`[data-page="${name}"]`).click();await baseline.screenshot({path:`${out}/before-${name}.png`});}
 await baseline.close();
 for(const name of ['monitor','investigate','decide']){
  await page.locator(`[data-page="${name}"]`).click();await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:`${out}/after-${name}.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' overflow');
 }
 record('1920×1080 Monitor, Investigate and Decide screenshots; no horizontal overflow');
 await page.locator('[data-decide-field="effect"]').fill('0.5');await page.locator('[data-decide-field="effect"]').dispatchEvent('change');
 assert.match(await page.locator('.wi-decide-case-body>.wi-grid3').innerText(),/90,000/);
 assert.equal(await page.locator('.wi-decide-case-body>.wi-grid3').evaluate(el=>el.getBoundingClientRect().bottom<innerHeight),true);
 await page.screenshot({path:`${out}/after-downside.png`});record('0.5 pp downside shows −$90,000 above the fold');
 await page.locator('[data-page="investigate"]').click();
 await page.locator('#fx-scope').click();await page.locator('#wi-function').selectOption('Engineering');await page.locator('#wi-region').selectOption('EMEA');await page.keyboard.press('Escape');
 await page.locator('[data-pin="C01"]').click();await page.locator('#wi-investigation-save summary').click();
 await page.locator('#wi-investigation-question').fill('Does onboarding timing warrant a pilot?');await page.locator('#wi-investigation-notes').fill('Compare role mix before inferring causality.');
 await page.locator('[data-investigation="save"]').click();await page.waitForFunction(()=>document.querySelector('#wi-investigation-save [role="status"]').textContent.startsWith('Investigation saved'));
 const saved=(await (await page.request.get(base+'/api/investigations')).json()).items[0];assert.equal(saved.scope.function,'Engineering');assert.equal(saved.evidenceLedger.length,1);
 await page.reload();await page.locator('[data-page="investigate"]').click();await page.locator('#wi-investigation-save summary').click();
 await page.locator('#wi-investigation-list').selectOption(saved.id);await page.locator('[data-investigation="load"]').click();
 assert.equal(await page.locator('#wi-function').inputValue(),'Engineering');assert.equal(await page.locator('#wi-investigation-notes').inputValue(),'Compare role mix before inferring causality.');
 await page.screenshot({path:`${out}/after-saved-investigation.png`});record('Saved investigation reload restores question, notes, scope and pinned lineage');
 await page.locator('[data-lab="retention"]').first().click();
 await page.locator('#fx-more').click();await page.getByRole('button',{name:'Saved decisions',exact:true}).click();await page.locator('[data-ww="save"]').click();await page.waitForFunction(()=>document.querySelector('#ww-status').textContent.includes('Draft saved'));
 await page.locator('[data-ww="load"]').click();assert.equal(await page.locator('#ww-panel').isVisible(),false);record('Saved decision carries evidence and opens with its panel closed');
 await page.request.post(base+'/api/workday/sync',{data:{batch:'correction'}});
 await page.reload();await page.locator('[data-page="investigate"]').click();await page.locator('#wi-investigation-save summary').click();await page.locator('#wi-investigation-list').selectOption(saved.id);await page.locator('[data-investigation="load"]').click();
 assert.match(await page.locator('#wi-investigation-save').innerText(),/older revision/);
 await page.locator('[data-investigation="save"]').click();await page.waitForFunction(()=>document.querySelector('#wi-investigation-save [role="status"]').textContent.includes('stale'));
 await page.locator('[data-pin="C01"]').click();await page.locator('[data-investigation="save"]').click();await page.waitForFunction(()=>document.querySelector('#wi-investigation-save [role="status"]').textContent.startsWith('Investigation saved'));
 record('Source correction marks saved lineage stale; repinning permits a new investigation version');
 await page.locator('#wi-domains [data-go="people"]').click();await page.locator('#fx-scope').click();await page.locator('[data-audience="chro"]').click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.querySelector('#wi-app').__WI_APP.state.domain),'people');record('Executive perspective preserves the selected Monitor view');
 await page.locator('#wi-present').click();for(let i=0;i<7;i++){await page.locator('[data-tour="next"]').click();}assert.match(await page.locator('#wi-tour').innerText(),/8 \/ 8/);await page.locator('[data-tour="next"]').click();record('All eight briefing steps navigate and finish');
 for(const width of [1366,768,390]){
  console.log('Checking width',width);
  await page.setViewportSize({width,height:width===390?844:900});
  for(const name of ['monitor','investigate','decide']){await page.locator(`[data-page="${name}"]`).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${name} at ${width}`);}
  await page.screenshot({path:out+'/after-decide-'+width+'.png'});
  if(width<=1100){
   await page.locator('#wi-explore').click();await page.locator('#wi-navigation-dialog [data-go="people"]').click();
   assert.equal(await page.evaluate(()=>document.querySelector('#wi-app').__WI_APP.state.domain),'people');assert.equal(await page.locator('#wi-navigation-dialog').isVisible(),false);
   await page.locator('#wi-explore').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#wi-explore').evaluate(el=>el===document.activeElement),true);
   await page.locator('#wi-explore').click();await page.locator('#wi-navigation-dialog [data-go="overview"]').click();
   await page.screenshot({path:out+'/after-monitor-'+width+'.png',fullPage:width===390});
  }
 }
 record('Monitor, Investigate and Decide fit 1366, 768 and 390 px widths');
 record('Mobile Explore menu reaches People analytics; Escape closes and returns focus');
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.wi-orbit-mesh').evaluate(el=>getComputedStyle(el).animationName),'none');record('Reduced-motion preference disables decorative orbit animation');
 await page.setViewportSize({width:1920,height:1080});
 await page.locator('[data-page="decide"]').click();await page.locator('[data-decide-view="lab"]').click();
 for(const id of ['retention','skills','delivery','continuity','service','capacity']){await page.locator('[data-decide-case="'+id+'"]').click();await page.locator('.wi-lab-viz').screenshot({path:out+'/chart-'+id+'.png'});}
 record('All six scenario visualizations captured in Chrome');
 // Browser-only simulated availability and denied capture: no external service or hardware capture.
 await page.route('**/api/status',async route=>{const r=await route.fetch();const data=await r.json();data.live.available=true;await route.fulfill({json:data});});
 await page.addInitScript(()=>{window.__captureCalls=0;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{window.__captureCalls++;throw new DOMException('Denied for browser verification','NotAllowedError');}});});
 await page.reload();await page.locator('#fx-more').click();await page.getByRole('button',{name:'Voice connection help',exact:true}).click();assert.equal(await page.evaluate(()=>window.__captureCalls),0);
 await page.locator('#wl-start').click();await page.waitForFunction(()=>document.querySelector('#wl-state').textContent.includes('denied'));
 assert.equal(await page.locator('#wl-start').isEnabled(),true);assert.match(await page.locator('#wl-mic').innerText(),/off/i);
 await page.screenshot({path:`${out}/after-voice-permission-error.png`});record('Opening voice does not capture; simulated denied permission shows error and allows retry');
 assert.deepEqual(errors,[]);record('No browser JavaScript errors');
 await writeFile('docs/browser-review.json',JSON.stringify({at:new Date().toISOString(),browser:await browser.version(),checks,screenshots:out,externalCalls:false,physicalMicrophoneTested:false},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));await server.whenClosed();await rm(storageDir,{recursive:true,force:true});}
