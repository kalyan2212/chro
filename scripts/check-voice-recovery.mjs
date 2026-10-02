// Browser/HTTP recovery regression. WebRTC, microphone and provider are simulated;
// session ownership, request cancellation, local calculations and UI are real.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createServer} from '../server.mjs';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const storageDir=await mkdtemp(join(tmpdir(),'chro-voice-recovery-'));
const output='docs/voice-recovery',password='synthetic-voice-recovery-password';
const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const blocked=new Map(),failures=new Set(),checks=[],errors=[];
let sessionSequence=0,modelCalls=0;
const gate=question=>{const value={started:Promise.withResolvers(),release:Promise.withResolvers(),aborted:false};blocked.set(question,value);return value;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,message='condition',ms=10000){const end=Date.now()+ms;while(!fn()){if(Date.now()>end)throw Error('Timed out waiting for '+message);await wait(25);}}
const server=createServer({apiKey:'TEST_ONLY_NEVER_SENT',password,storageDir,fetchImpl:async(endpoint,init)=>{
 if(endpoint.endsWith('/hangup'))return new Response(null,{status:200});
 if(endpoint==='https://api.openai.com/v1/live/sessions')return Response.json({session:{id:'recovery_session_'+(++sessionSequence)},transport:{type:'webrtc',sdp}});
 assert.equal(endpoint,'https://api.openai.com/v1/responses','only the fixed mocked provider is allowed');modelCalls++;
 const payload=JSON.parse(init.body),input=payload.input,user=input.find(item=>item.role==='user');
 const question=JSON.parse(user.content.find(item=>item.type==='input_text').text).request.question;
 const pending=blocked.get(question);
 if(pending){pending.started.resolve();await new Promise((resolve,reject)=>{const abort=()=>{pending.aborted=true;reject(init.signal.reason||new DOMException('Cancelled','AbortError'));};if(init.signal.aborted){abort();return;}init.signal.addEventListener('abort',abort,{once:true});pending.release.promise.then(()=>{init.signal.removeEventListener('abort',abort);resolve();});});}
 if(failures.has(question))return Response.json({error:{message:'Synthetic provider failure',type:'server_error'}},{status:500});
 const evidence=input.filter(item=>item.type==='function_call_output').flatMap(item=>JSON.parse(item.output).items||[]);
 if(!evidence.length)return Response.json({status:'completed',output:[{type:'function_call',call_id:'read_cohort',name:'inspect_metrics',arguments:JSON.stringify({metricIds:['C01'],scope:{function:'all',region:'all',period:'quarter'}})}]});
 const ref=evidence[0].refId;
 return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({headline:'Recovered cohort evidence',summary:'The matured cohort is the governed baseline.',sections:[{kind:'finding',title:'A governed baseline',text:'First-year exits are measured in the matured synthetic cohort.',evidenceRefs:[ref]}],unknowns:[],followups:[],panels:[{evidenceRef:ref,title:'First-year cohort',why:'Inspect the current baseline.'}]})}]}]});
}});
await server.ready;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHRO_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const pass=message=>{checks.push(message);console.log('PASS',message);};
let fixtureSequence=0;
async function fixture(){
 const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'}),requests=[];
 const login=await page.request.post(base+'/api/login',{data:{password}});assert.equal(login.status(),200);
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().endsWith('/api/live/delegate'))requests.push(request.postDataJSON());});
 await page.addInitScript(({sdp})=>{
  const h=window.__recovery={tracks:[],peers:[],events:[]};
  for(const type of ['wi-voice-state','wi-voice-answer','wi-voice-beat'])addEventListener(type,e=>h.events.push({type,detail:e.detail}));
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{const track={enabled:true,readyState:'live',addEventListener(){},stop(){this.readyState='ended';}};h.tracks.push(track);return {getTracks:()=>[track],getAudioTracks:()=>[track]};}});
  class Peer{constructor(){h.peers.push(this);this.connectionState='new';this.iceGatheringState='complete';}createDataChannel(){return this.channel={readyState:'open',sent:[],send(value){this.sent.push(JSON.parse(value));},close(){this.readyState='closed';}};}addTrack(){}async createOffer(){return {type:'offer',sdp};}async setLocalDescription(value){this.localDescription=value;}async setRemoteDescription(value){this.remoteDescription=value;}close(){this.connectionState='closed';}addEventListener(){}removeEventListener(){}}
  Object.defineProperty(window,'RTCPeerConnection',{configurable:true,value:Peer});
  h.emit=event=>h.peers.at(-1)?.channel.onmessage?.({data:JSON.stringify(event)});h.commentary=()=>h.peers.at(-1)?.channel.sent.filter(e=>e.type==='session.commentary.append')||[];
 },{sdp});
 await page.goto(base);await page.waitForFunction(()=>window.WI_STUDIO&&window.WI_LIVE&&!document.querySelector('#wl-start').disabled);
 const allocated=page.waitForResponse(r=>r.url().endsWith('/api/live/session'));await page.evaluate(()=>window.WI_LIVE.start());const data=await (await allocated).json();assert.ok(data.session?.id);
 await page.waitForFunction(()=>window.__recovery.peers.at(-1)?.remoteDescription);await page.evaluate(id=>window.__recovery.emit({type:'session.started',session:{id}}),data.session.id);
 const id=++fixtureSequence,first=`Explain first-year retention for recovery case ${id}.`,continuation=' Compare Engineering and Sales.',whole=first+continuation;
 return {page,requests,id,first,continuation,whole,sessionId:data.session.id,
  emit:event=>page.evaluate(event=>window.__recovery.emit(event),event),
  async startPartial({drain=false}={}){const pending=drain?null:gate(first);await this.emit({type:'session.input_transcript.delta',delta:first,start_ms:100,end_ms:700});await this.emit({type:'session.delegation.created',offset_ms:800,delegation:{id:'initial_'+id,target:'client'}});if(!drain){await until(()=>requests.length===1,'initial delegated request');await pending.started.promise;}return pending;},
  async continue(){await this.emit({type:'session.input_transcript.delta',delta:continuation,start_ms:900,end_ms:1300});},
  async answered(){await page.waitForFunction(()=>window.__recovery.events.some(e=>e.type==='wi-voice-answer'));},
  async close(){await page.request.post(base+'/api/live/close',{data:{sessionId:data.session.id}});await this.emit({type:'session.closed',reason:'close_requested',usage:{seconds:3}});await page.close();}
 };
}

try{
 const recovered=await fixture(),original=await recovered.startPartial();await recovered.continue();await recovered.answered();
 assert.equal(recovered.requests.length,2);assert.equal(recovered.requests[1].recovery,true);assert.match(recovered.requests[1].delegationId,/^recovery_/);assert.equal(recovered.requests[1].question,recovered.whole);await until(()=>original.aborted,'aborted first lookup');
 assert.match(await recovered.page.locator('#st-stage h1').innerText(),/Recovered cohort evidence/);const commentary=await recovered.page.evaluate(()=>window.__recovery.commentary());assert.equal(commentary.length,1);assert.equal(commentary[0].delegation_id,null);
 await recovered.emit({type:'session.delegation.created',offset_ms:1300,delegation:{id:'late_already_answered',target:'client'}});await recovered.emit({type:'session.commentary.appended',client_event_id:commentary[0].event_id});await recovered.page.waitForFunction(()=>window.__recovery.commentary().length===2);await wait(1100);assert.equal(recovered.requests.length,2);
 pass('Interrupted lookup recovers the complete question without provider redelegation; late duplicate delegation preserves accepted narration');await recovered.close();

 const drain=await fixture();await drain.startPartial({drain:true});await drain.continue();await drain.answered();assert.equal(drain.requests.length,1);assert.equal(drain.requests[0].recovery,true);assert.equal(drain.requests[0].question,drain.whole);pass('Speech arriving during the transcript drain cancels the partial lookup and recovers one complete question');await drain.close();

 const provider=await fixture();await provider.startPartial();await provider.continue();await provider.emit({type:'session.delegation.created',offset_ms:1400,delegation:{id:'provider_redelegated',target:'client'}});await provider.answered();await wait(1100);assert.equal(provider.requests.length,2);assert.equal(provider.requests[1].recovery,undefined);assert.equal(provider.requests[1].question,provider.whole);pass('A genuine provider redelegation supersedes the recovery timer without duplicate work');await provider.close();

 for(const action of ['typed','scope','image']){
  const f=await fixture();await f.startPartial();await f.continue();
  if(action==='typed')await f.page.evaluate(()=>window.WI_STUDIO.ask('Explain E05'));
  if(action==='scope')await f.page.locator('[data-scope="region"]').selectOption('EMEA');
  if(action==='image'){const png=await f.page.screenshot({type:'png'});await f.page.locator('#st-image-input').setInputFiles({name:'recovery-context.png',mimeType:'image/png',buffer:png});await f.page.waitForFunction(()=>window.WI_STUDIO.getImage());}
  await f.emit({type:'session.delegation.created',offset_ms:1400,delegation:{id:'late_after_'+action,target:'client'}});await wait(1300);assert.equal(f.requests.length,1,action+' must discard queued recovery and old transcript');assert.equal(await f.page.evaluate(()=>window.__recovery.events.some(e=>e.type==='wi-voice-answer')),false);await f.close();
 }
 pass('Typed questions, scope changes and image changes discard queued recovery and delayed old delegations');

 const inFlight=await fixture();await inFlight.startPartial();const recovering=gate(inFlight.whole);await inFlight.continue();await until(()=>inFlight.requests.length===2,'in-flight recovery');await recovering.started.promise;await inFlight.page.locator('#st-home').click();await until(()=>recovering.aborted,'context cancellation of recovery');recovering.release.resolve();await wait(1100);assert.equal(inFlight.requests.length,2);assert.equal(await inFlight.page.evaluate(()=>window.__recovery.events.some(e=>e.type==='wi-voice-answer')),false);pass('Navigation aborts an active recovery request and rejects its late result');await inFlight.close();

 for(const action of ['stop','source']){
  const f=await fixture();await f.startPartial();await f.continue();await f.page.evaluate(action=>action==='stop'?window.WI_LIVE.stop():dispatchEvent(new Event('wi-source-updated')),action);await wait(1100);assert.equal(f.requests.length,1);assert.equal(await f.page.evaluate(()=>window.__recovery.tracks.every(t=>!t.enabled)),true);await f.emit({type:'session.closed',reason:'close_requested',usage:{seconds:3}});assert.equal(await f.page.evaluate(()=>window.__recovery.tracks.every(t=>t.readyState==='ended')),true);assert.equal(await f.page.evaluate(()=>window.WI_LIVE.isActive()),false);await f.close();
 }
 pass('Stop and source refresh cancel recovery timers and release microphone tracks after closure');

 const exhausted=await fixture();await exhausted.startPartial();gate(exhausted.whole);await exhausted.continue();await until(()=>exhausted.requests.length===2,'first recovery');
 const second=exhausted.whole+' Include the denominator.';gate(second);await exhausted.emit({type:'session.input_transcript.delta',delta:' Include the denominator.',start_ms:1500,end_ms:1800});await until(()=>exhausted.requests.length===3,'second recovery');await exhausted.emit({type:'session.input_transcript.delta',delta:' Include the limitations.',start_ms:2000,end_ms:2300});await exhausted.page.waitForFunction(()=>document.querySelector('#wl-result').textContent.includes('two recovery attempts'));await wait(1100);assert.equal(exhausted.requests.length,3);assert.equal(await exhausted.page.locator('#wl-stop').isEnabled(),true);assert.equal(await exhausted.page.evaluate(()=>window.WI_LIVE.isActive()),true);pass('Repeated continuation stops after two recovery attempts with a visible retry instruction and working Stop');await exhausted.close();

 const failed=await fixture();await failed.startPartial();failures.add(failed.whole);await failed.continue();await failed.page.waitForFunction(()=>window.__recovery.commentary().some(e=>e.content.includes('did not complete')));await wait(1100);assert.equal(failed.requests.length,2);assert.equal(await failed.page.locator('#wi-live').isVisible(),false,'the error must be visible without opening the voice panel');const failureText=await failed.page.locator('#wl-result').textContent();assert.ok(failureText.trim());assert.equal(await failed.page.locator('#st-status').textContent(),failureText,'Studio must retain the recovery failure instead of replacing it with generic listening status');assert.equal(await failed.page.locator('#st-status').isVisible(),true);assert.equal(await failed.page.locator('#st-voice').getAttribute('aria-pressed'),'true');assert.match(await failed.page.locator('#st-voice').textContent(),/Stop conversation/);assert.equal(await failed.page.locator('#wl-stop').isEnabled(),true);assert.equal(await failed.page.evaluate(()=>window.__recovery.events.some(e=>e.type==='wi-voice-answer')),false);pass('A failed recovered analysis stays visible in Studio with the voice panel closed and leaves the active session stoppable');await failed.close();

 const owned=await fixture(),before=modelCalls,foreign=await browser.newContext();await foreign.request.post(base+'/api/login',{data:{password}});
 const request={sessionId:owned.sessionId,delegationId:'recovery_security_check',recovery:true,question:'Explain C01'};
 assert.equal((await foreign.request.post(base+'/api/live/delegate',{data:request})).status(),404);
 assert.equal((await owned.page.request.post(base+'/api/live/delegate',{data:{...request,recovery:'true'}})).status(),400);
 assert.equal((await owned.page.request.post(base+'/api/live/delegate',{data:{...request,delegationId:'pretend_provider'}})).status(),400);
 assert.equal(modelCalls,before,'invalid ownership and recovery metadata cannot start analytical work');await foreign.close();pass('Recovery retains cookie ownership and rejects non-boolean flags and invalid correlation prefixes before analytical work');await owned.close();

 assert.deepEqual(errors,[]);pass('No browser JavaScript errors or real provider requests');await mkdir(output,{recursive:true});await writeFile(output+'/report.json',JSON.stringify({checkedAt:new Date().toISOString(),browser:await browser.version(),checks,errors,externalProviderCalls:0,physicalMicrophoneTested:false,actualAudioPlaybackTested:false,protocol:'Real local HTTP, session ownership, calculation and UI; provider and WebRTC media simulated'},null,2));
}finally{
 for(const pending of blocked.values())pending.release.resolve();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.whenClosed();await rm(storageDir,{recursive:true,force:true});
}
