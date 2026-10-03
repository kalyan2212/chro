// Actual guide/renderer/source persistence with simulated speech and transport.
// All source writes use a disposable temporary directory; provider calls are forbidden.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createServer} from '../server.mjs';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';

const output='docs/voice-guided-edits';await mkdir(output,{recursive:true});
const storageDir=await mkdtemp(join(tmpdir(),'chro-voice-guide-'));
let providerCalls=0,applyCalls=0,undoCalls=0;
const server=createServer({apiKey:'',storageDir,fetchImpl(){providerCalls++;throw Error('Provider calls are forbidden in this test');}});
await server.ready;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHRO_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const checks=[],errors=[],requests=[],pass=name=>{checks.push(name);console.log('PASS',name);};
const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.url().endsWith('/api/source/apply'))applyCalls++;if(request.url().endsWith('/api/source/undo'))undoCalls++;});
 await page.addInitScript(sdp=>{
  const h=window.__guidedVoice={peers:[],tracks:[]};
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{const track={enabled:true,readyState:'live',addEventListener(){},stop(){this.readyState='ended';}};h.tracks.push(track);return {getTracks:()=>[track],getAudioTracks:()=>[track]};}});
  class Peer{constructor(){h.peers.push(this);this.iceGatheringState='complete';this.connectionState='new';}createDataChannel(){return this.channel={readyState:'open',sent:[],send(value){this.sent.push(JSON.parse(value));},close(){this.readyState='closed';}};}addTrack(){}async createOffer(){return {type:'offer',sdp};}async setLocalDescription(value){this.localDescription=value;}async setRemoteDescription(value){this.remoteDescription=value;}addEventListener(){}removeEventListener(){}close(){this.connectionState='closed';}}
  window.RTCPeerConnection=Peer;h.emit=event=>h.peers.at(-1)?.channel.onmessage?.({data:JSON.stringify(event)});
  h.commentary=()=>h.peers.at(-1)?.channel.sent.filter(event=>event.type==='session.commentary.append')||[];
 },sdp);
 await page.route('**/api/status',async route=>{const response=await route.fetch(),data=await response.json();data.live.available=true;await route.fulfill({response,json:data});});
 await page.route('**/api/live/session',route=>route.fulfill({json:{session:{id:'isolated_guided_voice'},transport:{type:'webrtc',sdp},maxSessionMs:900000}}));
 await page.route('**/api/live/close',route=>route.fulfill({json:{closed:true,finalization:'unconfirmed'}}));
 let reply=null,hold=null;
 await page.route('**/api/live/delegate',async route=>{
  const body=route.request().postDataJSON(),response=structuredClone(reply);requests.push(body);assert.ok(response,'Unexpected analytical delegation');
  if(hold)await hold;
  const event={type:'session.commentary.append',event_id:'guide_result_'+requests.length,delegation_id:body.recovery?null:body.delegationId,content:'UNVERIFIED_GUIDE_MODEL_CLAIM'};
  await route.fulfill({json:{sessionId:body.sessionId,delegationId:body.delegationId,...(body.recovery?{recovery:true}:{}),response,event,events:[event]}}).catch(()=>{});
 });
 await page.goto(base+'/?voice=manual');await page.waitForFunction(()=>WI_STUDIO?.getSourceEditContext&&WI_STUDIO?.showSourceEditGuide&&!document.querySelector('#wl-start').disabled);
 const initial=await (await page.request.get(base+'/api/data/snapshot')).json(),sourceVersion=initial.sourceVersion;
 const find=data=>data.cells.find(cell=>cell.month==='2026-09'&&cell.function==='Engineering'&&cell.region==='EMEA'),original=find(initial);
 const initialContext={sourceVersion,month:'2026-09',function:'Engineering',region:'EMEA',category:'cost',path:null,operation:null,value:null,allocation:null,reason:null};
 const guide=async context=>{const response=await page.request.post(base+'/api/source/guide',{data:{context}});assert.equal(response.status(),200);return response.json();};
 const guideReply=value=>({title:value.title,answer:'UNVERIFIED_GUIDE_MODEL_CLAIM',facts:[],evidence:[],action:{type:'clarify'},sourceOnly:true,sourceEditGuide:value});
 await page.evaluate(()=>WI_LIVE.start());await page.waitForFunction(()=>__guidedVoice.peers.at(-1)?.remoteDescription);await page.evaluate(()=>__guidedVoice.emit({type:'session.started',session:{id:'isolated_guided_voice'}}));
 let offset=0;
 const say=async(text,{delegate=true}={})=>{offset+=1500;await page.evaluate(({text,offset,delegate})=>{__guidedVoice.emit({type:'session.input_transcript.delta',delta:text,start_ms:offset,end_ms:offset+400});if(delegate)__guidedVoice.emit({type:'session.delegation.created',offset_ms:offset+500,delegation:{id:'guide_turn_'+offset,target:'client'}});},{text,offset,delegate});};
 const assertStep=async value=>{await page.waitForFunction(question=>WI_LIVE.getState().reason==='source-edit-guided'&&document.querySelector('#wl-result').textContent===question,value.nextQuestion);assert.deepEqual(await page.evaluate(()=>WI_STUDIO.getSourceEditContext()),value.context);assert.equal(await page.evaluate(question=>__guidedVoice.commentary().at(-1)?.content===question,value.nextQuestion),true);assert.equal(applyCalls,0);assert.equal((await (await page.request.get(base+'/api/data/snapshot')).json()).sourceVersion,sourceVersion);};
 let step=await guide(initialContext);reply=guideReply(step);await say('Update employee cost for Engineering EMEA in September 2026.',{delegate:false});await assertStep(step);
 assert.equal(requests[0].recovery,true);for(const label of ['Employee loaded cost','Overtime','External contractor'])assert.ok((await page.locator('#aa-source-panel').innerText()).includes(label));
 assert.equal(await page.locator('#wl-ai-caption,.st-caption,.an-caption').count(),0);
 await page.locator('#aa-source-panel').scrollIntoViewIfNeeded();await page.screenshot({path:output+'/guide-cost-fields-1920.png',animations:'disabled'});
 pass('A vague spoken update displays actual cost fields and asks its rendered field question without changing source data');
 const outdated=await guide({...step.context,path:'stock.costBreakdown.overtime'});reply=guideReply(outdated);let releaseHeld;hold=new Promise(resolve=>{releaseHeld=resolve;});
 const pendingRequest=page.waitForRequest('**/api/live/delegate');await say('Overtime.');await pendingRequest;
 await page.locator('button[data-source-path="stock.costBreakdown.contractors"]').click();
 assert.equal(await page.evaluate(()=>WI_STUDIO.getSourceEditContext().path),'stock.costBreakdown.contractors');
 await page.waitForFunction(()=>WI_LIVE.getState().reason==='context-changed');releaseHeld();hold=null;await page.waitForTimeout(150);
 assert.equal(await page.evaluate(()=>WI_STUDIO.getSourceEditContext().path),'stock.costBreakdown.contractors');assert.equal(await page.evaluate(question=>__guidedVoice.commentary().some(event=>event.content===question),outdated.nextQuestion),false);
 pass('A manual field selection immediately cancels a pending spoken choice and its delayed guide cannot overwrite or narrate the new selection');
 step=await guide({...step.context,path:'stock.costBreakdown.employeeLoaded'});reply=guideReply(step);await say('Employee loaded cost.',{delegate:false});await assertStep(step);assert.equal(requests.at(-1).sourceEditContext.path,'stock.costBreakdown.contractors');
 assert.match(step.nextQuestion,/amount|increase|multiplier/i);pass('A short spoken field choice retains the exact population and advances only to the amount question');
 step=await guide({...step.context,operation:'scale',value:1.01});reply=guideReply(step);await say('Increase it by one percent.',{delegate:false});await assertStep(step);assert.equal(requests.at(-1).sourceEditContext.path,'stock.costBreakdown.employeeLoaded');assert.equal(step.context.allocation,null);assert.ok(step.missing.includes('allocation'));assert.match(step.nextQuestion,/proportions/i);
 pass('The spoken amount preserves its selected field and requires an explicit employee-cost allocation');
 step=await guide({...step.context,allocation:'preserve_pay_level_proportions'});reply=guideReply(step);await say('Yes, preserve current pay-level cost proportions.');await assertStep(step);assert.equal(step.context.reason,null);assert.ok(step.missing.includes('reason'));assert.match(step.nextQuestion,/reason/i);
 pass('The explicit allocation choice advances to rationale without inventing a reason or applying a change');
 const reason='Annual market alignment';step=await guide({...step.context,reason});assert.equal(step.readyForProposal,true);
 const proposalResponse=await page.request.post(base+'/api/source/propose',{data:{expectedSourceVersion:sourceVersion,reason,changes:[{month:step.context.month,function:step.context.function,region:step.context.region,path:step.context.path,operation:step.context.operation,value:step.context.value,allocation:step.context.allocation}]}});assert.equal(proposalResponse.status(),201);const proposal=await proposalResponse.json();
 reply={...guideReply(step),sourceEditProposal:proposal};await say(reason+'.');await page.waitForFunction(id=>WI_STUDIO.getPendingEdit()?.id===id,proposal.id);assert.equal(applyCalls,0);assert.equal((await (await page.request.get(base+'/api/data/snapshot')).json()).sourceVersion,sourceVersion);assert.equal(await page.evaluate(()=>__guidedVoice.commentary().some(event=>event.content.includes('UNVERIFIED_GUIDE_MODEL_CLAIM'))),false);
 assert.match(await page.locator('#wl-result').innerText(),/not been applied/);await page.locator('#aa-source-panel').scrollIntoViewIfNeeded();await page.screenshot({path:output+'/guide-proposal-1920.png',animations:'disabled'});
 pass('The spoken rationale produces exact review rows; proposal review supersedes the earlier guide and remains unapplied');
 const beforeConfirmationRequests=requests.length;await say('Apply.');await page.waitForFunction(()=>WI_LIVE.getState().reason==='source-confirmation-incomplete');assert.equal(applyCalls,0);assert.equal(requests.length,beforeConfirmationRequests);assert.equal(await page.evaluate(()=>WI_STUDIO.getPendingEdit()?.id),proposal.id);assert.match(await page.locator('#wl-result').innerText(),/apply these changes/);
 pass('An incomplete spoken Apply prompts locally for exact confirmation, preserving the proposal without a write or analytical request');
 await say('Apply these changes.',{delegate:false});await page.waitForFunction(()=>WI_LIVE.getState().reason==='source-edit-complete');const changed=await (await page.request.get(base+'/api/data/snapshot')).json();assert.equal(applyCalls,1);assert.equal(find(changed).stock.costBreakdown.employeeLoaded,Math.round(original.stock.costBreakdown.employeeLoaded*1.01*100)/100);assert.equal(await page.evaluate(()=>WI_LIVE.isActive()),true);
 const sourceHistory=await (await page.request.get(base+'/api/source/history')).json();assert.ok(JSON.stringify(sourceHistory).includes(reason));
 pass('Explicit spoken Apply persists employee loaded cost with the exact user rationale and recalculates the dashboard');
 await say('Undo that source change.',{delegate:false});await page.waitForFunction(()=>document.querySelector('#wl-result').textContent.includes('undone'));const restored=await (await page.request.get(base+'/api/data/snapshot')).json();assert.equal(undoCalls,1);assert.equal(find(restored).stock.costBreakdown.employeeLoaded,original.stock.costBreakdown.employeeLoaded);assert.equal(find(restored).stock.annualCostRunRate,original.stock.annualCostRunRate);
 pass('Spoken undo restores the original source values through the actual persistence endpoint');
 await page.evaluate(()=>{WI_LIVE.stop();__guidedVoice.emit({type:'session.closed',reason:'close_requested',usage:{seconds:10}});});assert.equal(await page.evaluate(()=>__guidedVoice.tracks.every(track=>track.readyState==='ended')&&__guidedVoice.peers.every(peer=>peer.connectionState==='closed')),true);assert.deepEqual(errors,[]);assert.equal(providerCalls,0);
 await writeFile(output+'/browser-report.json',JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,providerCalls,delegations:requests.length,applyCalls,undoCalls,storage:'Isolated temporary directory; existing .state and .env untouched',transport:'Simulated speech and Live protocol; real source guide, renderer and HTTP persistence'},null,2));
}finally{
 await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.whenClosed();
 assert.equal(dirname(resolve(storageDir)),resolve(tmpdir()));assert.ok(basename(storageDir).startsWith('chro-voice-guide-'));await rm(storageDir,{recursive:true,force:true});
}
