// Real catalogue, engine, application and browser. The analyst provider is a local stub.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createServer} from '../server.mjs';
import {analyze} from '../analyst.mjs';
import {createEvidenceTools} from '../evidence-tools.mjs';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const out='docs/discovery';await mkdir(out,{recursive:true});
const storageDir=await mkdtemp(join(tmpdir(),'chro-discovery-browser-'));
let providerCalls=0;
const server=createServer({apiKey:'',storageDir,fetchImpl(){providerCalls++;throw Error('External requests are forbidden in this test');}});
await server.ready;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const snapshot=await (await fetch(base+'/api/data/snapshot')).json();
const scope={function:'all',region:'all',period:'quarter'};
const question='Explore every available workforce cost category.';
const checks=[],errors=[];let requests=0,lastPayload;
const pass=name=>{checks.push(name);console.log('PASS',name);};
async function fixture(selectedScope=scope){
 let round=0;
 return analyze({request:{question,scope:selectedScope,channel:'voice'},snapshot,upstream:async payload=>{
  if(round++===0)return {status:'completed',output:[{type:'function_call',call_id:'catalogue-discovery',name:'discover_evidence',arguments:JSON.stringify({topic:'cost',scope:selectedScope})}]};
  const output=payload.input.find(item=>item.type==='function_call_output');const result=JSON.parse(output.output);const inventory=result.items.find(item=>item.discovery);assert.ok(inventory);
  const refs=inventory.previewRefs;
  return {status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({
   headline:'Explore the workforce cost evidence',summary:'All available cost choices appear below. Observed workforce costs and modelled decisions use distinct populations and time bases.',
   sections:[{kind:'finding',title:'Start with the cost mix',text:'The available annual cost categories are employee loaded cost, overtime and external contractors.',evidenceRefs:[refs[0]]},{kind:'recommendation',title:'Choose a useful next view',text:'Open any category, measure or scenario to explore its evidence and assumptions.',evidenceRefs:[]},{kind:'limitation',title:'Know the available detail',text:'Separate base salary, benefit, bonus and employer-tax amounts are not supplied by this workspace.',evidenceRefs:[refs[0]]}],
   unknowns:[],followups:['Compare workforce cost by function'],panels:refs.map((ref,index)=>({evidenceRef:ref,title:['Cost component mix','Annual workforce cost','Cost against plan'][index],why:'Inspect the current governed observation.'}))
  })}]}]};
 }});
}
const browser=await chromium.launch({executablePath:process.env.CHRO_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const data=await fixture();assert.ok(data.discovery?.responses);
 const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/ask',async route=>{requests++;lastPayload=route.request().postDataJSON();if(lastPayload.question===question)await route.fulfill({json:await fixture(lastPayload.scope)});else await route.continue();});
 await page.goto(base+'/?voice=manual');await page.waitForFunction(()=>window.WI_STUDIO&&document.querySelectorAll('.st-signal strong').length===3);
 await page.locator('#st-question').fill(question);await page.locator('.st-send').click();await page.waitForSelector('.an-discovery');await page.waitForFunction(()=>!document.querySelector('.st-send').disabled);
 assert.equal(await page.locator('.an-discovery-card').count(),data.discovery.items.length);
 for(const item of data.discovery.items){const card=page.locator('.an-discovery-card').filter({has:page.locator('.an-discovery-name',{hasText:item.label})});assert.ok(await card.isVisible(),item.label);assert.match(await card.innerText(),item.basis==='observed'?/Observed/i:/Modelled/i);if(item.value)assert.ok((await card.innerText()).includes(item.value));}
 assert.equal(await page.locator('.an-discovery-view').count(),data.discovery.views.length);
 assert.equal(await page.locator('.an-discovery .an-tab').count(),0);
 assert.equal(await page.locator('#st-caption,#wl-ai-caption,.an-caption,.vg-caption').count(),0);
 const dock=await page.locator('.st-dock').boundingBox();for(const item of data.discovery.items.filter(item=>item.id.startsWith('cost:'))){const rect=await page.locator('[data-discovery-id="'+item.id+'"]').boundingBox();assert.ok(rect.y+rect.height<dock.y,item.label+' must be visible above the composer');}
 await page.screenshot({path:out+'/cost-discovery-1920.png',animations:'disabled'});pass('Every matched category, measure, scenario and dashboard view is listed; all three calculated cost categories fit above the desktop composer');

 await page.evaluate(()=>{window.WI_STUDIO.prepareGuide(window.WI_CONVERSATION.getAnswer());window.WI_STUDIO.speakGuide('Overtime VOICE_ONLY_PROBE_NO_CAPTIONS');});
 assert.equal(await page.locator('[data-discovery-id="cost:overtime"]').getAttribute('aria-current'),'true');assert.equal(await page.evaluate(()=>document.body.innerText.includes('VOICE_ONLY_PROBE_NO_CAPTIONS')),false);
 await page.evaluate(()=>window.WI_STUDIO.stopGuide());assert.equal(await page.locator('.an-discovery-card[aria-current=true]').count(),0);pass('Internal voice cues highlight matching catalogue cards without rendering the spoken transcript');

 const before=requests;await page.locator('[data-discovery-id="cost:overtime"]').click();await page.waitForFunction(()=>window.WI_CONVERSATION.getAnswer()?.savePolicy?.supported===false);
 assert.equal(requests,before,'a retrieved cost component must open without another analysis request');assert.equal(await page.locator('.studio-chart-row').count(),3);assert.match(await page.locator('.studio-chart figcaption').innerText(),/Annual run-rate components/);assert.doesNotMatch(await page.locator('.studio-chart figcaption').innerText(),/ratio|denominator/i);
 const mix=Object.values(data.discovery.responses).find(response=>response.savePolicy?.supported===false);
 for(const row of mix.presentation.chart.rows)assert.ok((await page.locator('.studio-chart svg').textContent()).includes(new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(row.value)));
 const componentDock=await page.locator('.st-dock').boundingBox();for(const row of await page.locator('.studio-chart-row').all()){const rect=await row.boundingBox();assert.ok(rect.y+rect.height<componentDock.y,'all component bars must fit above the composer');}assert.equal(await page.getByRole('button',{name:'Save investigation',exact:true}).count(),0);assert.match(await page.locator('.st-save-limit').innerText(),/not persisted/);await page.screenshot({path:out+'/cost-components-1920.png',animations:'disabled'});
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:/^Export brief/}).click();const download=await downloading,brief=await readFile(await download.path(),'utf8');for(const fact of mix.facts)assert.ok(brief.includes(fact.label+': '+fact.value));assert.ok(brief.includes(mix.sourceVersion));
 pass('Retrieved component chart opens immediately with exact USD bars and export; unsupported component persistence is clearly excluded');

 await page.locator('#st-back').click();await page.waitForSelector('.an-discovery');assert.equal(await page.locator('.an-discovery-card').count(),data.discovery.items.length);
 await page.locator('[data-discovery-id="cost-view:function"]').click();await page.waitForFunction(()=>window.WI_CONVERSATION.getAnswer()?.breakdown?.dimension==='function');assert.equal(requests,before);
 assert.equal(await page.getByRole('button',{name:'Save investigation',exact:true}).isVisible(),true);pass('Back restores the full catalogue and a retrieved function comparison opens without another model request');
 await page.locator('#st-back').click();await page.waitForSelector('.an-discovery');await page.locator('[data-discovery-id="metric:E02"]').click();await page.getByRole('button',{name:'Save investigation',exact:true}).click();await page.locator('.st-save-form textarea').fill('Catalogue total follow-up');await page.locator('.st-save-form .st-primary').click();await page.waitForFunction(()=>document.querySelector('.st-save-form [role=status]').textContent.includes('Investigation saved.'));
 const saved=(await (await fetch(base+'/api/investigations')).json()).items.find(item=>item.notes==='Catalogue total follow-up');assert.equal(saved.metricId,'E02');assert.equal(saved.observation.sourceVersion,snapshot.sourceVersion);assert.deepEqual(saved.scope,scope);await page.locator('#st-dialog-close').click();pass('Annual total remains savable with the original governed metric, scope and source revision');

 await page.locator('#st-back').click();await page.waitForSelector('.an-discovery');await page.locator('[data-discovery-id="scenario:retention"]').click();await page.waitForFunction(()=>window.WI_CONVERSATION.getAnswer()?.action?.caseId==='retention');assert.equal(lastPayload.question,data.discovery.items.find(item=>item.caseId==='retention').question);pass('An uncalculated scenario choice uses its server-authored question through the existing analytical flow');

 await page.evaluate(response=>window.WI_CONVERSATION.showResponse(response,{origin:'studio'}),data);for(const width of [1366,768,390]){await page.setViewportSize({width,height:width===390?844:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('.an-discovery-card').count(),data.discovery.items.length);if(width===390){const value=await page.locator('.an-discovery-value').first().boundingBox(),dock=await page.locator('.st-dock').boundingBox();assert.ok(value.y+value.height<dock.y,'mobile must show a cost value before scrolling');await page.screenshot({path:out+'/cost-discovery-390.png',animations:'disabled'});}}pass('Laptop, tablet and phone retain the entire catalogue without horizontal page overflow');
 const catalogueOnly={...structuredClone(data),panels:[]};await page.evaluate(response=>window.WI_CONVERSATION.showResponse(response,{origin:'studio'}),catalogueOnly);assert.equal(await page.locator('.an-empty').count(),0);await page.evaluate(()=>{WI_STUDIO.prepareGuide(WI_CONVERSATION.getAnswer());WI_STUDIO.speakGuide('Start with the cost mix');WI_STUDIO.stopGuide();});pass('Discovery without calculated panels still presents useful choices and narration without an empty-canvas prompt');
 const all=createEvidenceTools({snapshot}).execute('discover_evidence',{topic:'all',scope}).items.find(item=>item.discovery).discovery,unavailable=all.items.find(item=>item.metricId==='P09');assert.equal(unavailable.available,false);const limited=structuredClone(catalogueOnly);limited.discovery.items=[unavailable];await page.evaluate(response=>window.WI_CONVERSATION.showResponse(response,{origin:'studio'}),limited);assert.equal(await page.locator('.an-discovery-card').isDisabled(),true);assert.match(await page.locator('.an-discovery-meta').innerText(),/Unavailable/i);assert.doesNotMatch(await page.locator('.an-discovery-meta').innerText(),/Observed/i);pass('An unavailable DEI composite is explicitly labelled unavailable and cannot be opened as an observed measure');
 const literal={...structuredClone(catalogueOnly)};literal.discovery.items[0].label='<img src=x onerror="window.__unsafeDiscovery=true">';await page.evaluate(response=>window.WI_CONVERSATION.showResponse(response,{origin:'studio'}),literal);assert.equal(await page.locator('.an-discovery-card img').count(),0);assert.equal(await page.evaluate(()=>window.__unsafeDiscovery),undefined);assert.ok((await page.locator('.an-discovery-name').first().innerText()).includes('<img'));pass('Catalogue labels render as literal text, never executable markup');

 assert.deepEqual(errors,[]);assert.equal(providerCalls,0);pass('No browser errors or external provider calls');await writeFile(out+'/browser-report.json',JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,provider:'Local provider stub with real governed discovery tools and engine calculations',externalProviderCalls:providerCalls},null,2));
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.whenClosed();await rm(storageDir,{recursive:true,force:true});}
