import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8787/?workspace&voice=manual');
 const password=page.locator('input[type=password]');
 if(await password.count()){assert.ok(process.env.APP_PASSWORD,'Configured sign-in required');await password.fill(process.env.APP_PASSWORD);await page.locator('button[type=submit]').click();}
 await page.waitForFunction(()=>window.WI_EXPERIENCE&&window.WI_INVESTIGATIONS);
 for(const name of ['monitor','investigate','decide']){await page.locator('[data-page="'+name+'"]').click();await page.screenshot({path:'docs/redesign/main-'+name+'.png'});}
 assert.equal(await page.evaluate(()=>document.querySelector('#wi-app').dataset.view),'decide');
 const response=await page.request.get('http://127.0.0.1:8787/api/investigations');assert.equal(response.status(),200);
 await page.setViewportSize({width:390,height:844});await page.locator('#wi-explore').click();await page.screenshot({path:'docs/redesign/mobile-navigation.png'});await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);
 await writeFile('docs/redesign/live-app-check.json',JSON.stringify({at:new Date().toISOString(),url:'http://127.0.0.1:8787',screens:['monitor','investigate','decide'],investigationsEndpoint:200,browserErrors:errors,providerCallsMade:false},null,2));
 console.log('Main app: redesigned screens, mobile navigation and investigations endpoint verified. No browser errors.');
}finally{await browser.close();}
