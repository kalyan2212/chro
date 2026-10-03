// Real Studio controllers and HTTP persistence in isolated temporary storage.
// Speech recognition, microphone and Live transport are simulated; no provider calls.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createServer} from '../server.mjs';
import {createEvidenceTools} from '../evidence-tools.mjs';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';

const output='docs/voice-actions';await mkdir(output,{recursive:true});
const storageDir=await mkdtemp(join(tmpdir(),'chro-voice-actions-'));
let providerCalls=0,delegateCalls=0,applyCalls=0,undoCalls=0;
const server=createServer({apiKey:'',storageDir,fetchImpl(){providerCalls++;throw Error('External provider requests forbidden');}});
await server.ready;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHRO_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const checks=[],errors=[],pass=name=>{checks.push(name);console.log('PASS',name);};
const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});
 page.on('pageerror',error=>{errors.push(error.message);console.error('Browser error: '+error.message);});page.on('request',request=>{if(request.url().endsWith('/api/source/apply'))applyCalls++;if(request.url().endsWith('/api/source/undo'))undoCalls++;});
 await page.addInitScript(sdp=>{
  const h=window.__voiceActions={peers:[],tracks:[],events:[]};
  for(const type of ['wi-voice-state','wi-voice-view-action','wi-source-updated'])addEventListener(type,event=>h.events.push({type,detail:event.detail}));
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{const track={enabled:true,readyState:'live',addEventListener(){},stop(){this.readyState='ended';}};h.tracks.push(track);return {getTracks:()=>[track],getAudioTracks:()=>[track]};}});
  class Peer{constructor(){h.peers.push(this);this.iceGatheringState='complete';this.connectionState='new';}createDataChannel(){return this.channel={readyState:'open',sent:[],send(value){this.sent.push(JSON.parse(value));},close(){this.readyState='closed';}};}addTrack(){}async createOffer(){return {type:'offer',sdp};}async setLocalDescription(value){this.localDescription=value;}async setRemoteDescription(value){this.remoteDescription=value;}addEventListener(){}removeEventListener(){}close(){this.connectionState='closed';}}
  window.RTCPeerConnection=Peer;h.emit=event=>h.peers.at(-1)?.channel.onmessage?.({data:JSON.stringify(event)});
  h.commentary=()=>h.peers.at(-1)?.channel.sent.filter(event=>event.type==='session.commentary.append')||[];
 },sdp);
 await page.route('**/api/status',async route=>{const response=await route.fetch(),data=await response.json();data.live.available=true;await route.fulfill({response,json:data});});
 await page.route('**/api/live/session',route=>route.fulfill({json:{session:{id:'isolated_voice_actions'},transport:{type:'webrtc',sdp},maxSessionMs:900000}}));
 await page.route('**/api/live/close',route=>route.fulfill({json:{closed:true,finalization:'unconfirmed'}}));
 let delegateResponse=null;
 await page.route('**/api/live/delegate',async route=>{delegateCalls++;assert.ok(delegateResponse,'Unexpected analytical request');const body=route.request().postDataJSON(),event={type:'session.commentary.append',event_id:'mock_delegate_'+delegateCalls,delegation_id:body.recovery?null:body.delegationId,content:'UNVERIFIED_MODEL_SUCCESS_MUST_NOT_BE_SPOKEN'};await route.fulfill({json:{sessionId:body.sessionId,delegationId:body.delegationId,...(body.recovery?{recovery:true}:{}),response:delegateResponse,event,events:[event]}});});
 await page.goto(base+'/?voice=manual');await page.waitForFunction(()=>window.WI_STUDIO?.getPendingEdit&&window.WI_ASSISTANT_ACTIONS&&window.WI_STUDIO_CHARTS?.getActive&&!document.querySelector('#wl-start').disabled);
 const initial=await (await page.request.get(base+'/api/data/snapshot')).json(),tools=createEvidenceTools({snapshot:initial}),scope={function:'all',region:'all',period:'quarter'};
 const cost=tools.execute('discover_evidence',{topic:'cost',scope}).items.find(item=>item.response?.savePolicy?.supported===false).response;
 await page.evaluate(data=>WI_CONVERSATION.showResponse(data,{origin:'voice'}),cost);await page.waitForSelector('.studio-chart-controls');
 const evidenceBefore=await page.evaluate(()=>JSON.stringify(WI_CONVERSATION.getAnswer()));
 await page.evaluate(()=>WI_LIVE.start());await page.waitForFunction(()=>window.__voiceActions.peers.at(-1)?.remoteDescription);await page.evaluate(()=>__voiceActions.emit({type:'session.started',session:{id:'isolated_voice_actions'}}));
 let offset=100;const say=async(text,{delegate=false}={})=>{offset+=1200;await page.evaluate(({text,offset,delegate})=>{__voiceActions.emit({type:'session.input_transcript.delta',delta:text,start_ms:offset,end_ms:offset+400});if(delegate)__voiceActions.emit({type:'session.delegation.created',offset_ms:offset+500,delegation:{id:'utterance_'+offset,target:'client'}});},{text,offset,delegate});};
 await say('Change bar to line');await page.waitForFunction(()=>WI_STUDIO.getViewContext()?.currentType==='line');await page.waitForFunction(()=>__voiceActions.commentary().some(event=>/line chart/.test(event.content)));
 await say('Make it pie');await page.waitForFunction(()=>WI_STUDIO.getViewContext()?.currentType==='pie');await page.waitForFunction(()=>__voiceActions.commentary().some(event=>/pie chart/.test(event.content)));
 assert.equal(delegateCalls,0);assert.equal(await page.evaluate(()=>JSON.stringify(WI_CONVERSATION.getAnswer())),evidenceBefore);assert.equal(await page.locator('.studio-chart-slice').count(),3);assert.equal(await page.locator('#wl-ai-caption,.st-caption,.an-caption').count(),0);
 await page.evaluate(()=>document.querySelector('.studio-chart').scrollIntoView({block:'center',behavior:'instant'}));await page.screenshot({path:output+'/voice-pie-1920.png',animations:'disabled'});
 pass('Spoken bar-to-line and make-it-pie commands update the actual chart without analytical calls or changed evidence');
 const retention=tools.execute('calculate_scenario',{caseId:'retention',overrides:{effect:.5}}).items[0].response;
 await page.evaluate(async data=>{await WI_CONVERSATION.showResponse(data,{origin:'voice'});WI_LIVE.syncContext({force:true});},retention);
 const oldType=await page.evaluate(()=>WI_STUDIO.getViewContext().currentType);await say('Make it pie');await page.waitForFunction(()=>WI_LIVE.getState().reason==='chart-unavailable');assert.equal(await page.evaluate(()=>WI_STUDIO.getViewContext().currentType),oldType);assert.match(await page.locator('#wl-result').innerText(),/negative|signed|pie/i);assert.equal(delegateCalls,0);pass('The real renderer refuses a misleading scenario pie and voice reports its actual refusal');
 const month=initial.months.at(-1),find=snapshot=>snapshot.cells.find(cell=>cell.month===month&&cell.function==='Engineering'&&cell.region==='EMEA');const original=find(initial),before=original.stock.costBreakdown.overtime;
 const sourceRows=await (await page.request.get(base+'/api/source/data?'+new URLSearchParams({month,function:'Engineering',region:'EMEA',category:'cost'}))).json();
 delegateResponse={title:'Stored source records',answer:'UNVERIFIED_MODEL_SUCCESS_MUST_NOT_BE_SPOKEN',facts:[],evidence:[],action:{type:'clarify'},sourceVersion:initial.sourceVersion,scope,sourceOnly:true,sourceData:sourceRows};
 await say('Show the latest Engineering EMEA source cost records.',{delegate:true});await page.waitForFunction(()=>WI_LIVE.getState().reason==='source-records-displayed');assert.equal(await page.locator('#aa-source-panel tbody tr').count(),sourceRows.rows.length);assert.ok((await page.locator('#aa-source-panel').innerText()).includes(new Intl.NumberFormat('en-US').format(before)));assert.equal(applyCalls,0);pass('Spoken source inspection displays the real flat source records and exact current values without changing the scene or stored data');
 const proposed=await page.request.post(base+'/api/source/propose',{data:{expectedSourceVersion:initial.sourceVersion,changes:[{month,function:'Engineering',region:'EMEA',path:'stock.costBreakdown.overtime',operation:'add',value:1000}],reason:'Isolated browser test: explicit user correction'}});assert.equal(proposed.status(),201);const proposal=await proposed.json();
 delegateResponse={title:'Source correction proposal',answer:'UNVERIFIED_MODEL_SUCCESS_MUST_NOT_BE_SPOKEN',facts:[],evidence:[],action:{type:'clarify'},sourceVersion:initial.sourceVersion,scope,sourceOnly:true,sourceEditProposal:proposal};
 await say('Increase the latest Engineering EMEA source overtime cost by one thousand dollars.',{delegate:true});await page.waitForFunction(id=>WI_STUDIO.getPendingEdit()?.id===id,proposal.id);await page.waitForFunction(()=>__voiceActions.commentary().some(event=>event.content.includes('has not been applied')));assert.equal(applyCalls,0);assert.equal((await (await page.request.get(base+'/api/data/snapshot')).json()).sourceVersion,initial.sourceVersion);assert.equal(await page.locator('#aa-source-panel tbody tr').count(),2);
 await page.locator('#aa-source-panel').scrollIntoViewIfNeeded();await page.screenshot({path:output+'/voice-source-proposal-1920.png',animations:'disabled'});pass('A spoken source-edit request displays exact before/after rows and leaves persisted data unchanged before confirmation');
 await say('Apply these changes');await page.waitForFunction(()=>WI_LIVE.getState().reason==='source-edit-complete');const updated=await (await page.request.get(base+'/api/data/snapshot')).json();assert.equal(applyCalls,1);assert.equal(find(updated).stock.costBreakdown.overtime,before+1000);assert.equal(find(updated).stock.annualCostRunRate,original.stock.annualCostRunRate+1000);assert.equal(await page.evaluate(()=>WI_LIVE.isActive()),true);assert.equal(await page.evaluate(()=>WI_STUDIO.getViewContext()),null,'Superseded chart metadata must not block the next evidence question');assert.match(await page.locator('#wl-result').innerText(),/saved/);assert.equal(await page.evaluate(()=>__voiceActions.commentary().some(event=>event.content.includes('UNVERIFIED_MODEL_SUCCESS'))),false);pass('Explicit spoken confirmation persists the identified proposal, recalculates costs and keeps its own Live session connected');
 await say('Undo that source change');await page.waitForFunction(()=>WI_LIVE.getState().reason==='source-edit-complete'&&document.querySelector('#wl-result').textContent.includes('undone'));const restored=await (await page.request.get(base+'/api/data/snapshot')).json();assert.equal(undoCalls,1);assert.equal(find(restored).stock.costBreakdown.overtime,before);assert.equal(find(restored).stock.annualCostRunRate,original.stock.annualCostRunRate);assert.notEqual(restored.sourceVersion,initial.sourceVersion);assert.equal(await page.evaluate(()=>WI_LIVE.isActive()),true);const audit=await (await page.request.get(base+'/api/audit')).json();assert.ok(audit.events.some(event=>event.type==='source.edit.applied'));assert.ok(audit.events.some(event=>event.type==='source.edit.undone'));pass('Explicit spoken undo restores exact values through the real endpoint and records both source operations');
 await page.evaluate(()=>{WI_LIVE.stop();__voiceActions.emit({type:'session.closed',reason:'close_requested',usage:{seconds:8}});});assert.equal(await page.evaluate(()=>__voiceActions.tracks.every(track=>track.readyState==='ended')&&__voiceActions.peers.every(peer=>peer.connectionState==='closed')),true);assert.deepEqual(errors,[]);assert.equal(providerCalls,0);pass('Final close releases simulated media; no JavaScript errors, physical microphone or external provider calls');
 await writeFile(output+'/browser-report.json',JSON.stringify({checkedAt:new Date().toISOString(),checks,errors,providerCalls,delegateCalls,applyCalls,undoCalls,storage:'Isolated temporary directory; existing .state and .env untouched',transport:'Simulated recognition and Live protocol; real renderer and HTTP source persistence'},null,2));
}finally{
 await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.whenClosed();
 assert.equal(dirname(resolve(storageDir)),resolve(tmpdir()));assert.ok(basename(storageDir).startsWith('chro-voice-actions-'));await rm(storageDir,{recursive:true,force:true});
}
