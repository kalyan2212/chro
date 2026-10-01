import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createLiveService } from '../live.mjs';
import { answer, demoPlan, validateRequest } from '../engine.mjs';

const SDP = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const sessionResponse = id => Response.json({ session: { id, secret: 'never forward session configuration' }, transport: { type: 'webrtc', sdp: SDP } });
const request = { question: 'What is first-year retention?', scope: { function: 'all', region: 'all', period: 'quarter' } };
const governed = async body => answer(body, demoPlan(body), 'api');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
function service(options = {}) {
 const calls = [], events = []; let id=0;
 const live = createLiveService({ apiKey: 'private-test-key', fetchImpl: async (url, init) => { calls.push({url,init}); return url.endsWith('/hangup') ? new Response(null,{status:200}) : sessionResponse(`live_${++id}`); }, ask: governed, onEvent: e => events.push(e), ...options });
 return { live, calls, events };
}

test('creates documented WebRTC client-delegation session and keeps key/config private',async t => {
 const {live,calls}=service(); t.after(() => live.shutdown());
 const result=await live.create({sdp:SDP,history:[{role:'user',text:'Earlier question'},{role:'assistant',text:'Earlier observation'}]});
 assert.equal(calls[0].url,'https://api.openai.com/v1/live/sessions');
 const sent=JSON.parse(calls[0].init.body);
 assert.deepEqual(sent.session.delegation,{type:'client'}); assert.equal(sent.session.model,'gpt-live-1'); assert.equal(sent.session.store,false);
 assert.deepEqual(sent.transport,{type:'webrtc',sdp:SDP});
 assert.equal(sent.session.input[0].content[0].type,'input_text'); assert.equal(sent.session.input[1].content[0].type,'output_text');
 assert.equal(sent.session.audio,undefined); assert.equal(calls[0].init.headers.Authorization,'Bearer private-test-key');
 assert.deepEqual(result.session,{id:'live_1'}); assert.equal(JSON.stringify(result).includes('private-test-key'),false); assert.equal(JSON.stringify(result).includes('secret'),false);
 assert.ok(Object.isFrozen(result.transport));
});
test('validates SDP, source context and session capacity before contacting OpenAI',async t => {
 const {live,calls}=service({maxSessions:1}); t.after(() => live.shutdown());
  await assert.rejects(live.create({sdp:'https://attacker.invalid'}),{status:400});
  await assert.rejects(live.create({sdp:SDP+'m=video 9 UDP/TLS/RTP/SAVPF 96\r\n'}),{status:400});
 await assert.rejects(live.create({sdp:SDP,scope:{region:'unknown'}}),{status:400});
 assert.equal(calls.length,0); await live.create({sdp:SDP});
 await assert.rejects(live.create({sdp:SDP}),{status:429}); assert.equal(calls.length,1);
 assert.equal(live.status().activeSessions,1);
});
test('concurrent creations reserve capacity while upstream is pending',async t => {
 const pending=deferred(); const {live}=service({maxSessions:1,fetchImpl: async url => url.endsWith('/hangup') ? new Response(null,{status:200}) : pending.promise}); t.after(() => live.shutdown());
 const creating=live.create({sdp:SDP}); await assert.rejects(live.create({sdp:SDP}),{status:429}); pending.resolve(sessionResponse('live_busy')); await creating;
});
test('requires API configuration and does not pretend demo mode is continuous voice',async () => {
 const {live,calls}=service({apiKey:''}); assert.equal(live.status().available,false); await assert.rejects(live.create({sdp:SDP}),{status:503}); assert.equal(calls.length,0);
});
test('governed evidence returns immutable snapshot and documented bounded commentary event',async t => {
 let original;
 const {live}=service({ask:async body => { assert.ok(Object.isFrozen(body.scope)); original=await governed(body); return original; }}); t.after(() => live.shutdown());
 await live.create({sdp:SDP});
 const result=await live.delegate({sessionId:'live_1',delegationId:'item_delegate_1',...request});
 assert.equal(result.event.type,'session.commentary.append'); assert.equal(result.event.delegation_id,'item_delegate_1');
 assert.ok(Buffer.byteLength(result.event.content)<=450); assert.match(result.event.content,/Synthetic data/); assert.ok(result.response.facts.length);
 const expected=result.response.facts[0].value; original.facts[0].value='tampered'; assert.equal(result.response.facts[0].value,expected);
 assert.throws(() => {result.response.facts[0].value='wrong';},TypeError);
 await assert.rejects(live.delegate({sessionId:'live_1',delegationId:'item_delegate_1',...request}),{status:409});
});
test('rejects unknown sessions, arbitrary paths and invalid delegation IDs',async t => {
 const {live,calls}=service(); t.after(() => live.shutdown()); await live.create({sdp:SDP});
 for(const id of ['../other','https://attacker.invalid','live_1/../../sessions']) {
  await assert.rejects(live.close(id),{status:400}); await assert.rejects(live.delegate({sessionId:id,delegationId:'item_1',...request}),{status:400});
 }
 await assert.rejects(live.delegate({sessionId:'live_unknown',delegationId:'item_1',...request}),{status:404});
 await assert.rejects(live.delegate({sessionId:'live_1',delegationId:'item_1?redirect=x',...request}),{status:400});
 assert.equal(calls.length,1);
});
test('spoken backend content preserves whole decimal facts and never slices a long fact',async t => {
 let words='The rate is 12.3% with a 0.5 percentage-point scenario change.';
 const {live}=service({ask:async body=>({...await governed(body),answer:words})});t.after(()=>live.shutdown());await live.create({sdp:SDP});
 const first=await live.delegate({sessionId:'live_1',delegationId:'item_decimal',...request});assert.equal(first.event.content,'Synthetic data. '+words);
 words='A very long indivisible statement '+ 'x'.repeat(600)+' at 12.3%.';
 const second=await live.delegate({sessionId:'live_1',delegationId:'item_long',...request});assert.ok(Buffer.byteLength(second.event.content)<=450);assert.match(second.event.content,/Read the evidence card/);assert.equal(second.event.content.includes('12.3'),false);
});
test('retention downside commentary includes 0.5 pp, negative net, program cost and fixed population',async t=>{
 const {live}=service();t.after(()=>live.shutdown());await live.create({sdp:SDP});
 const result=await live.delegate({sessionId:'live_1',delegationId:'item_downside',question:'Test the 0.5 pp downside'});
 assert.match(result.event.content,/0\.5 pp/);assert.match(result.event.content,/−\$90k/);assert.match(result.event.content,/Program cost: \$240k/);assert.match(result.event.content,/1,200 hires/);assert.match(result.event.content,/Conditional synthetic/);assert.ok(Buffer.byteLength(result.event.content)<=450);
});
test('all scenario briefs pack complete calculated facts with their conditional fixed basis',async t=>{
 const {live}=service({ask:async body=>answer(body,{intent:'scenario',metricId:null,caseId:body.context.caseId,overrides:{}},'api')});t.after(()=>live.shutdown());await live.create({sdp:SDP});
 for(const caseId of ['retention','skills','delivery','continuity','service','capacity']){
  const result=await live.delegate({sessionId:'live_1',delegationId:'item_'+caseId,question:'Model this scenario',context:{caseId}});
  assert.match(result.event.content,/Conditional synthetic scenario; not a forecast/);assert.ok(Buffer.byteLength(result.event.content)<=450);
  assert.ok(result.response.facts.filter(f=>f.label!=='Assumptions').some(f=>result.event.content.includes(`${f.label}: ${f.value}.`)),caseId);
 }
});
test('rich narration preserves all scenario observations across independently bounded verified beats',async t=>{
 const {live}=service({ask:async body=>answer(body,{intent:'scenario',metricId:null,caseId:body.context.caseId,overrides:{}},'api')});t.after(()=>live.shutdown());await live.create({sdp:SDP});
 for(const caseId of ['retention','skills','delivery','continuity','service','capacity']){
  const result=await live.delegate({sessionId:'live_1',delegationId:'rich_'+caseId,question:'Explain this scenario',context:{caseId}});
  assert.ok(result.events.length>1 && result.events.length<=8);
  assert.deepEqual(result.event,result.events[0]);assert.ok(Object.isFrozen(result.events));
  assert.equal(result.narration.count,result.events.length);assert.equal(result.narration.synchronization,'transcript-estimate');
  assert.equal(new Set(result.events.map(event=>event.event_id)).size,result.events.length);
  const combined=result.events.map(event=>event.content).join(' ');
  for(const event of result.events){assert.ok(Buffer.byteLength(event.content)<=450);assert.equal(event.delegation_id,'rich_'+caseId);}
  for(const fact of result.response.facts.filter(f=>f.label!=='Assumptions'))assert.ok(combined.includes(`${fact.label}: ${fact.value}.`),`${caseId}: ${fact.label}`);
 }
});
test('multi-beat narration never slices multibyte or numeric statements to meet its byte bound',async t=>{
 const full='Validated result: 12.3%.',tooLong='検証'.repeat(100)+' 999.9%.';
 const {live}=service({ask:async body=>({...await governed(body),answer:full+' '+tooLong,facts:[{label:'Scoped result',value:'12.3%'},{label:'Oversize indivisible definition',value:tooLong}],evidence:[]})});t.after(()=>live.shutdown());await live.create({sdp:SDP});
 const result=await live.delegate({sessionId:'live_1',delegationId:'rich_utf8',...request});
 assert.ok(result.events.every(event=>Buffer.byteLength(event.content)<=450));
 assert.ok(result.events.some(event=>event.content.includes(full)));assert.equal(result.events.some(event=>event.content.includes('999.9')),false);
});
test('new delegation cancels earlier work and late results cannot escape',async t => {
 const old=deferred(); let call=0,oldSignal;
 const {live}=service({ask:async (body,signal) => { if(++call===1){oldSignal=signal;return old.promise;} return governed(body); }}); t.after(() => live.shutdown());
 await live.create({sdp:SDP}); const first=live.delegate({sessionId:'live_1',delegationId:'item_1',...request});
 const second=await live.delegate({sessionId:'live_1',delegationId:'item_2',...request}); assert.equal(oldSignal.aborted,true); assert.equal(second.delegationId,'item_2');
 old.resolve(await governed(validateRequest(request))); await assert.rejects(first,{status:409});
});
test('close aborts application work and is idempotent without claiming final usage',async t => {
 const waiting=deferred(); let seen;
 const {live,calls}=service({ask:async (_,signal) => {seen=signal;return waiting.promise;}}); t.after(() => live.shutdown());
 await live.create({sdp:SDP}); const pending=live.delegate({sessionId:'live_1',delegationId:'item_pending',...request});
 const closed=await live.close('live_1'); assert.equal(seen.aborted,true); assert.equal(closed.finalization,'unconfirmed'); assert.equal(closed.usage,null);
 assert.equal(closed.hangupAccepted,true); assert.equal(live.status().activeSessions,0); assert.deepEqual(await live.close('live_1'),closed);
 assert.equal(calls.filter(c=>c.url.endsWith('/hangup')).length,1);
 waiting.resolve(await governed(validateRequest(request))); await assert.rejects(pending,{status:409});
 await assert.rejects(live.delegate({sessionId:'live_1',delegationId:'item_new',...request}),{status:404});
});
test('REST hangup failure still releases local state and stays unconfirmed',async () => {
 const {live}=service({fetchImpl:async url => url.endsWith('/hangup') ? new Response(null,{status:400}) : sessionResponse('live_sip_only')});
 await live.create({sdp:SDP}); const result=await live.close('live_sip_only'); assert.equal(result.hangupAccepted,false); assert.equal(result.finalization,'unconfirmed'); assert.equal(live.status().activeSessions,0);
});
test('bad upstream SDP is cleaned up and non-success body is not exposed',async () => {
 const calls=[]; const {live}=service({fetchImpl:async url => {calls.push(url);return url.endsWith('/hangup') ? new Response(null,{status:200}) : Response.json({session:{id:'live_bad'},transport:{type:'webrtc',sdp:'bad'}});}});
 await assert.rejects(live.create({sdp:SDP}),{status:502}); assert.equal(live.status().activeSessions,0); assert.equal(calls.length,2);
 const unavailable=service({fetchImpl:async()=>new Response('sensitive upstream diagnostic',{status:403})}).live;
 await assert.rejects(unavailable.create({sdp:SDP}),error=>error.status===502&&!error.message.includes('sensitive'));
});
test('startup cancelled after response closes the orphan session',async () => {
 const controller=new AbortController(); const {live}=service({fetchImpl:async url => {if(url.endsWith('/hangup'))return new Response(null,{status:200}); controller.abort(); return sessionResponse('live_cancelled');}});
 await assert.rejects(live.create({sdp:SDP},controller.signal),{status:499}); assert.equal(live.status().activeSessions,0);
});

const source=readFileSync(new URL('../public/live.js',import.meta.url),'utf8');
function browser({permissionPending=false,playBlocked=false,delegatePending=false,renderPending=false,toolbar=false,sessionFailure=null,multiBeat=false,statusCode=200}={}) {
 class Element {
  constructor(){this.listeners=new Map();this.attrs={};this.textContent='';this.disabled=false;this.classList={toggle(){}};this.srcObject=null;this.paused=true;}
  addEventListener(type,fn){this.listeners.set(type,fn);} fire(type,value={}){return this.listeners.get(type)?.(value);} setAttribute(k,v){this.attrs[k]=v;} focus(){this.focused=true;}
  querySelector(selector){return nodes.get(selector)||nodes.set(selector,new Element()).get(selector);}
  appendChild(child){this.child=child;} click(){downloads.push({href:this.href,download:this.download});} remove(){this.removed=true;}
  pause(){this.paused=true;} async play(){if(playBlocked)throw Error('autoplay');this.paused=false;}
 }
 const nodes=new Map(),host=new Element(),requests=[],peers=[],shown=[],timers=new Map(),listeners=new Map(),streams=[],downloads=[],blobs=[],emitted=[],permission=deferred(),delegation=deferred(),render=deferred(); let timerId=0;
 const connectionReport={schema:'workforce-connection-report.v1',appVersion:'2.0.1',recentErrors:[],lastConnectionCheck:{status:'metadata_reachable',message:'Metadata endpoint reached. Voice still needs a session test.'}};
 const anchor={before(button){this.inserted=button;}},root={querySelector:selector=>selector==='#wi-present'?anchor:null};
 const stream=()=>{const track={enabled:true,readyState:'live',addEventListener(){},stop(){this.readyState='ended';}};const s={getTracks:()=>[track],getAudioTracks:()=>[track]};streams.push(s);return s;};
 class Peer {
  constructor(){peers.push(this);this.connectionState='new';this.iceGatheringState='complete';}
  createDataChannel(label){assert.equal(label,'oai-events');this.channel={readyState:'open',sent:[],send(text){this.sent.push(JSON.parse(text));},close(){this.readyState='closed';}};return this.channel;}
  addTrack(){} async createOffer(){return {type:'offer',sdp:SDP};} async setLocalDescription(value){this.localDescription=value;} async setRemoteDescription(value){this.remoteDescription=value;}
  close(){this.connectionState='closed';} addEventListener(){} removeEventListener(){}
 }
 const scope={function:'all',region:'all',period:'quarter'};
 const window={RTCPeerConnection:Peer,addEventListener:(type,fn)=>listeners.set(type,fn),dispatchEvent:e=>{emitted.push(e);return listeners.get(e.type)?.(e);},WI_CONVERSATION:{cancel(){},getScope:()=>scope,getContext:()=>({}),getHistory:()=>[],async showResponse(data,options){if(renderPending)await render.promise;if(options?.isCurrent&&!options.isCurrent())return false;shown.push(data);return true;}}};
 const fetch=async(url,init)=>{
  requests.push({url,init}); if(url==='/api/status')return {ok:statusCode===200,status:statusCode,json:async()=>({version:'2.0.1',live:{available:true}})};
  if(url==='/api/diagnostics'||url==='/api/diagnostics/connection')return {ok:true,json:async()=>structuredClone(connectionReport)};
  if(url==='/api/live/session'&&sessionFailure)return {ok:false,status:502,json:async()=>structuredClone(sessionFailure)};
  if(url==='/api/live/session')return {ok:true,json:async()=>({session:{id:'live_browser'},transport:{type:'webrtc',sdp:SDP},maxSessionMs:900000})};
  if(url==='/api/live/close')return {ok:true};
  if(url==='/api/live/delegate'){
   const body=JSON.parse(init.body); const data=await governed(validateRequest(body));
   const value={sessionId:body.sessionId,delegationId:body.delegationId,response:data,event:{type:'session.commentary.append',event_id:'result_mock',delegation_id:body.delegationId,content:data.answer}};
   if(multiBeat){value.event.content='Synthetic data. The validated result is ready.';value.events=[value.event,{...value.event,event_id:'result_mock_2',content:'First-year exits use a mature cohort denominator.'},{...value.event,event_id:'result_mock_3',content:'This is an association, not a causal conclusion.'}];}
   if(delegatePending)await delegation.promise; return {ok:true,json:async()=>value};
  }
  throw Error('Unexpected URL '+url);
 };
 vm.runInNewContext(source,{window,document:{getElementById:id=>id==='wi-live'?host:id==='wi-app'&&toolbar?root:null,createElement:()=>new Element(),body:new Element()},navigator:{mediaDevices:{getUserMedia:()=>permissionPending?permission.promise:Promise.resolve(stream())},sendBeacon:(url,body)=>{requests.push({url,body,beacon:true});return true;}},RTCPeerConnection:Peer,MediaStream:class{},Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},TextEncoder,fetch,Blob,URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:report-'+blobs.length;},revokeObjectURL(){}},AbortController,AbortSignal,structuredClone,crypto:webcrypto,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 const event=value=>peers.at(-1).channel.onmessage?.({data:JSON.stringify(value)});
 const fireTimers=async ms=>{for(const [id,t]of [...timers])if(t.ms===ms){timers.delete(id);await t.fn();}await tick();};
 return {window,scope,requests,peers,shown,timers,streams,host,downloads,blobs,emitted,toolbar:anchor.inserted,node:s=>host.querySelector(s),event,fireTimers,setStatus:value=>{statusCode=value;},setSessionFailure:value=>{sessionFailure=value;},resolvePermission:()=>permission.resolve(stream()),resolveDelegate:()=>delegation.resolve(),resolveRender:()=>render.resolve(),async start(){await tick();window.WI_LIVE.open();await host.querySelector('#wl-start').fire('click');event({type:'session.started',session:{id:'live_browser'}});await tick();}};
}
test('voice startup failure releases media, exposes connection help, exports safe context and permits a retry',async()=>{
 const failure={error:'The server could not verify the API certificate.',code:'TLS_TRUST',diagnosticId:'22222222-2222-4222-8222-222222222222'};
 const h=browser({sessionFailure:failure,toolbar:true});await tick();await h.node('#wl-start').fire('click');
 assert.equal(h.window.WI_LIVE.isActive(),false);assert.equal(h.streams[0].getTracks()[0].readyState,'ended');assert.equal(h.peers[0].connectionState,'closed');assert.equal(h.timers.size,0);
 assert.equal(h.node('#wl-help').open,true);assert.match(h.node('#wl-state').textContent,/TLS_TRUST/);assert.match(h.node('#wl-usage').textContent,/startup not confirmed/);assert.equal(h.node('#wl-start').disabled,false);assert.match(h.node('#wl-version').textContent,/2.0.1/);
 await h.node('#wl-report').fire('click');assert.equal(h.downloads[0].download,'workforce-connection-report.json');
 const report=JSON.parse(await h.blobs[0].text());assert.equal(report.browser.lastVoiceFailure.code,'TLS_TRUST');assert.equal(report.browser.lastVoiceFailure.diagnosticId,failure.diagnosticId);assert.equal(report.browser.lastVoiceFailure.stage,'server.live_session');assert.equal(report.browser.lastVoiceFailure.sessionAcknowledged,false);
 assert.equal(JSON.stringify(report).includes(SDP),false);assert.equal(JSON.stringify(report).includes(failure.error),false);assert.equal(h.node('#wl-report').disabled,false);
 await h.fireTimers(1000);h.setSessionFailure(null);await h.start();assert.equal(h.window.WI_LIVE.isActive(),true);h.event({type:'session.closed',usage:{seconds:1}});assert.equal(h.timers.size,0);
});
test('connection help checks metadata without microphone capture or automatic session creation',async()=>{
 const h=browser();await tick();await h.node('#wl-check').fire('click');
 assert.equal(h.streams.length,0);assert.equal(h.requests.filter(x=>x.url==='/api/diagnostics/connection').length,1);assert.equal(h.requests.some(x=>x.url==='/api/live/session'),false);assert.match(h.node('#wl-diagnostic-state').textContent,/Voice still needs a session test/);assert.equal(h.node('#wl-check').disabled,false);
 await h.start();assert.equal(h.node('#wl-check').disabled,true);await h.node('#wl-check').fire('click');assert.equal(h.requests.filter(x=>x.url==='/api/diagnostics/connection').length,1);h.event({type:'session.closed',usage:{seconds:1}});
});
test('continuous voice panel starts collapsed; toolbar opens without microphone and closes with finalization',async()=>{
 const h=browser({toolbar:true});await tick();assert.equal(h.host.hidden,true);assert.equal(h.toolbar.textContent,'Continuous voice');assert.equal(h.toolbar.attrs['aria-expanded'],'false');assert.equal(h.toolbar.attrs['aria-controls'],'wi-live');
 h.toolbar.fire('click');assert.equal(h.host.hidden,false);assert.equal(h.toolbar.attrs['aria-expanded'],'true');assert.equal(h.streams.length,0);assert.equal(h.requests.some(x=>x.url==='/api/live/session'),false);
 await h.start();assert.match(h.toolbar.textContent,/active/);h.node('#wl-close').fire('click');
 assert.equal(h.host.hidden,true);assert.equal(h.toolbar.attrs['aria-expanded'],'false');assert.equal(h.toolbar.focused,true);assert.match(h.toolbar.textContent,/finishing/);assert.equal(h.peers[0].channel.sent.at(-1).type,'session.close');assert.notEqual(h.peers[0].connectionState,'closed');assert.equal(h.streams[0].getTracks()[0].enabled,false);
 h.event({type:'session.closed',reason:'close_requested',usage:{seconds:6}});assert.equal(h.peers[0].connectionState,'closed');assert.equal(h.streams[0].getTracks()[0].readyState,'ended');assert.equal(h.toolbar.textContent,'Continuous voice');assert.match(h.toolbar.title,/Final voice duration received/);assert.equal(h.timers.size,0);assert.equal(h.host.hidden,true);
});
test('transcripts preserve exact spaces, repeated words and overlap independently',()=>{
 const h=browser(),t=h.window.WI_LIVE_PROTOCOL.timeline();
 assert.equal(t.add({type:'session.input_transcript.delta',event_id:'a',delta:'I I',start_ms:100,end_ms:200}),true);
 t.add({type:'session.output_transcript.delta',event_id:'b',delta:'Yes',start_ms:150,end_ms:250});
 t.add({type:'session.input_transcript.delta',event_id:'c',delta:' mean retention',start_ms:200,end_ms:400});
 assert.equal(t.text('user'),'I I mean retention');assert.equal(t.text('assistant'),'Yes');
 assert.equal(t.add({type:'session.input_transcript.delta',event_id:'a',delta:'duplicate',start_ms:100,end_ms:200}),false);
 assert.equal(t.add({type:'session.input_transcript.delta',delta:'bad',start_ms:-1,end_ms:2}),false);
});
test('late permission after Stop is released without creating a session',async()=>{
 const h=browser({permissionPending:true});await tick();const start=h.node('#wl-start').fire('click');await tick();h.node('#wl-stop').fire('click');h.resolvePermission();await start;
 assert.equal(h.streams[0].getTracks()[0].readyState,'ended');assert.equal(h.peers.length,0);assert.equal(h.requests.some(x=>x.url==='/api/live/session'),false);assert.equal(h.timers.size,0);
});
test('WebRTC starts via HTTP and waits for session.started; blocked autoplay is explicit',async()=>{
 const h=browser({playBlocked:true});await h.start();const pc=h.peers[0];
 assert.equal(pc.remoteDescription.type,'answer');assert.equal(pc.channel.sent.some(x=>x.type==='session.start'),false);assert.equal(pc.channel.sent[0].type,'session.instructions.append');
 await pc.ontrack({track:{stop(){}},streams:[{}]});assert.match(h.node('#wl-playback').textContent,/Press Play/);assert.match(h.node('#wl-mic').textContent,/active/);
 h.node('#wl-mute').fire('click');assert.equal(h.streams[0].getTracks()[0].enabled,false);assert.match(h.node('#wl-state').textContent,/billed/);
 h.event({type:'session.closed',reason:'close_requested',usage:{seconds:3.5}});assert.equal(h.streams[0].getTracks()[0].readyState,'ended');assert.match(h.node('#wl-usage').textContent,/3.5 s · final/);assert.equal(h.timers.size,0);
});
test('browser assembles delegation question from transcript and displays only correlated evidence',async()=>{
 const h=browser();await h.start();h.event({type:'session.input_transcript.delta',event_id:'input1',delta:'What is first-year retention?',start_ms:100,end_ms:800});h.event({type:'session.delegation.created',offset_ms:900,delegation:{id:'item_voice',target:'client'}});
 await h.fireTimers(300);assert.equal(h.shown.length,1);assert.ok(Object.isFrozen(h.shown[0]));
 assert.equal(JSON.parse(h.requests.find(r=>r.url==='/api/live/delegate').init.body).question,'What is first-year retention?');
 const result=h.peers[0].channel.sent.find(x=>x.type==='session.commentary.append');assert.equal(result.delegation_id,'item_voice');
 h.event({type:'session.closed',usage:{seconds:4}});
});
test('richer voice beats wait for their own injection acknowledgements and emit honest presentation events',async()=>{
 const h=browser({multiBeat:true});await h.start();h.event({type:'session.input_transcript.delta',delta:'What is retention?',start_ms:100,end_ms:200});h.event({type:'session.delegation.created',offset_ms:300,delegation:{id:'item_beats',target:'client'}});await h.fireTimers(300);
 const spoken=()=>h.peers[0].channel.sent.filter(event=>event.type==='session.commentary.append');
 assert.equal(spoken().length,1);
 const answerEvent=h.emitted.find(event=>event.type==='wi-voice-answer');assert.equal(answerEvent.detail.turnId,'item_beats');assert.equal(answerEvent.detail.beatCount,3);assert.ok(Object.isFrozen(answerEvent.detail.response));
 h.event({type:'session.commentary.appended',client_event_id:'foreign_result'});assert.equal(spoken().length,1);
 h.event({type:'session.commentary.appended',client_event_id:'result_mock'});assert.equal(spoken().length,2);
 h.event({type:'session.commentary.appended',client_event_id:'result_mock'});assert.equal(spoken().length,2);
 assert.equal(h.emitted.some(event=>event.type==='wi-voice-state'&&event.detail.phase==='speaking'),false);
 h.event({type:'session.output_transcript.delta',delta:'The retention result',start_ms:400,end_ms:900});
 assert.equal(h.emitted.at(-1).type,'wi-voice-transcript');assert.equal(h.emitted.at(-1).detail.role,'assistant');assert.ok(h.emitted.some(event=>event.type==='wi-voice-state'&&event.detail.phase==='speaking'));
 h.event({type:'session.commentary.appended',client_event_id:'result_mock_2'});assert.equal(spoken().length,3);
 h.event({type:'session.commentary.appended',client_event_id:'result_mock_3'});assert.equal([...h.timers.values()].some(timer=>timer.ms===15000),false);
 h.event({type:'session.closed',usage:{seconds:4}});assert.equal(h.timers.size,0);
});
test('speech, manual scope change and Stop each discard queued narration before late acknowledgements',async()=>{
 for(const interrupt of ['speech','scope','stop']){
  const h=browser({multiBeat:true});await h.start();h.event({type:'session.input_transcript.delta',delta:'What is retention?',start_ms:100,end_ms:200});h.event({type:'session.delegation.created',offset_ms:300,delegation:{id:'item_cancel_beats',target:'client'}});await h.fireTimers(300);
  if(interrupt==='speech')h.event({type:'session.input_transcript.delta',delta:'actually headcount',start_ms:400,end_ms:600});
  else if(interrupt==='scope'){h.scope.region='EMEA';h.window.dispatchEvent({type:'wi-context-changed'});assert.match(h.peers[0].channel.sent.at(-2).content,/Stop the previous explanation/);}
  else h.node('#wl-stop').fire('click');
  h.event({type:'session.commentary.appended',client_event_id:'result_mock'});
  assert.equal(h.peers[0].channel.sent.filter(event=>event.type==='session.commentary.append').length,1,interrupt);
  h.event({type:'session.closed',usage:{seconds:4}});assert.equal(h.timers.size,0);
 }
});
test('missing injection acknowledgement does not blindly flush remaining narration or claim playback completion',async()=>{
 const h=browser({multiBeat:true});await h.start();h.event({type:'session.input_transcript.delta',delta:'What is retention?',start_ms:100,end_ms:200});h.event({type:'session.delegation.created',offset_ms:300,delegation:{id:'item_no_ack',target:'client'}});await h.fireTimers(300);await h.fireTimers(15000);
 assert.equal(h.peers[0].channel.sent.filter(event=>event.type==='session.commentary.append').length,1);assert.match(h.node('#wl-result').textContent,/has not acknowledged/);
 h.event({type:'session.commentary.appended',client_event_id:'result_mock'});assert.equal(h.peers[0].channel.sent.filter(event=>event.type==='session.commentary.append').length,1);
 h.event({type:'session.closed',usage:{seconds:4}});
});
test('voice verifies current sign-in before microphone capture and exposes recovery after expiry',async()=>{
 const h=browser();await tick();h.setStatus(401);await h.node('#wl-start').fire('click');
 assert.equal(h.streams.length,0);assert.equal(h.peers.length,0);assert.equal(h.requests.some(request=>request.url==='/api/live/session'),false);
 assert.equal(h.node('#wl-signin').hidden,false);assert.match(h.node('#wl-state').textContent,/Reload this page and sign in again/);assert.equal(h.window.WI_LIVE.isActive(),false);assert.equal(h.timers.size,0);
 assert.equal(h.emitted.at(-1).detail.code,'HTTP_401');assert.equal(h.emitted.at(-1).detail.phase,'error');
 h.setStatus(200);await h.start();assert.equal(h.node('#wl-signin').hidden,true);h.event({type:'session.closed',usage:{seconds:1}});
 const initial=browser({statusCode:401});await tick();assert.equal(initial.node('#wl-signin').hidden,false);assert.equal(initial.node('#wl-start').disabled,true);
});
test('multi-beat protocol rejects oversized UTF-8, duplicate identity and mismatched primary events',()=>{
 const h=browser(),event={type:'session.commentary.append',event_id:'result_one',delegation_id:'item_one',content:'Synthetic data.'};
 const result={sessionId:'session_one',delegationId:'item_one',response:{answer:'Verified'},event,events:[event]};
 const matches=value=>h.window.WI_LIVE_PROTOCOL.matches(value,'session_one','item_one');
 assert.equal(matches(result),true);
 assert.equal(matches({...result,events:[event,event]}),false);
 assert.equal(matches({...result,events:[{...event,content:'検'.repeat(151)}]}),false);
 assert.equal(matches({...result,events:[{...event,event_id:'result_other'}]}),false);
 assert.equal(matches({...result,events:[]}),false);
});
test('new speech aborts pending backend work and discards late response',async()=>{
 const h=browser({delegatePending:true});await h.start();h.event({type:'session.input_transcript.delta',delta:'What is retention?',start_ms:100,end_ms:200});h.event({type:'session.delegation.created',offset_ms:300,delegation:{id:'item_old',target:'client'}});
 const work=h.fireTimers(300);await tick();h.event({type:'session.input_transcript.delta',delta:' actually headcount',start_ms:400,end_ms:600});h.resolveDelegate();await work;
 assert.equal(h.shown.length,0);assert.equal(h.requests.find(r=>r.url==='/api/live/delegate').init.signal.aborted,true);assert.equal(h.peers[0].channel.sent.some(x=>x.type==='session.commentary.append'),false);
 h.event({type:'session.closed',usage:{seconds:4}});
});
test('an interruption during the transcript drain never launches an outdated lookup',async()=>{
 const h=browser();await h.start();h.event({type:'session.input_transcript.delta',delta:'What is retention?',start_ms:100,end_ms:200});h.event({type:'session.delegation.created',offset_ms:300,delegation:{id:'item_drain',target:'client'}});
 h.event({type:'session.input_transcript.delta',delta:'actually headcount',start_ms:400,end_ms:600});await h.fireTimers(300);
 assert.equal(h.requests.some(request=>request.url==='/api/live/delegate'),false);assert.equal(h.shown.length,0);
 h.event({type:'session.closed',usage:{seconds:4}});
});
test('interruption during asynchronous visual refresh prevents stale view mutation',async()=>{
 const h=browser({renderPending:true});await h.start();h.event({type:'session.input_transcript.delta',delta:'What is retention?',start_ms:100,end_ms:200});h.event({type:'session.delegation.created',offset_ms:300,delegation:{id:'item_render',target:'client'}});
 const work=h.fireTimers(300);await tick();h.event({type:'session.input_transcript.delta',delta:' actually headcount',start_ms:400,end_ms:600});h.resolveRender();await work;assert.equal(h.shown.length,0);
 h.event({type:'session.closed',usage:{seconds:4}});
});
test('scope changes while work is pending discard response',async()=>{
 const h=browser({delegatePending:true});await h.start();h.event({type:'session.input_transcript.delta',delta:'What is retention?',start_ms:100,end_ms:200});h.event({type:'session.delegation.created',offset_ms:300,delegation:{id:'item_scope',target:'client'}});
 const work=h.fireTimers(300);await tick();h.scope.period='rolling12';h.resolveDelegate();await work;assert.equal(h.shown.length,0);h.event({type:'session.closed',usage:{seconds:4}});
});
test('graceful close retains transport until final event, timeout releases without claiming final',async()=>{
 const h=browser();await h.start();h.event({type:'session.usage.updated',usage:{seconds:12}});h.node('#wl-stop').fire('click');
 assert.equal(h.peers[0].channel.sent.at(-1).type,'session.close');assert.notEqual(h.peers[0].connectionState,'closed');assert.equal(h.streams[0].getTracks()[0].enabled,false);
 await h.fireTimers(15000);assert.equal(h.peers[0].connectionState,'closed');assert.match(h.node('#wl-state').textContent,/unconfirmed/);assert.match(h.node('#wl-usage').textContent,/12.0 s.*not final/);assert.equal(h.timers.size,0);
});
test('pagehide closes locally and sends best-effort server notification',async()=>{
 const h=browser();await h.start();h.window.dispatchEvent({type:'pagehide'});assert.equal(h.streams[0].getTracks()[0].readyState,'ended');assert.ok(h.requests.find(x=>x.url==='/api/live/close'&&x.beacon));assert.equal(h.timers.size,0);
});
