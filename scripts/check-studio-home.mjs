// Real application and browser; microphone, playback and upstream voice are simulated.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createServer} from '../server.mjs';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';

const out='docs/studio-home';await mkdir(out,{recursive:true});
const storageDir=await mkdtemp(join(tmpdir(),'chro-home-'));
let externalCalls=0;
const server=createServer({apiKey:'',storageDir,fetchImpl:()=>{externalCalls++;throw Error('Unexpected provider call');}});
await server.ready;await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHRO_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const checks=[],errors=[],pages=[];const pass=name=>{checks.push(name);console.log('PASS',name);};

async function fixture(options={}) {
 const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});pages.push(page);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(options=>{
  const h=window.__homeVoice={captures:0,plays:0,sessions:0,closes:0,delegates:0,tracks:[],peers:[],events:[],denied:!!options.denied,blocked:!!options.blocked,pending:!!options.pending};
  addEventListener('wi-voice-state',e=>h.events.push(e.detail));
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
   h.captures++;if(h.denied)throw new DOMException('Permission denied','NotAllowedError');
   if(h.pending)await new Promise(r=>h.resolveCapture=r);
   const track={enabled:true,readyState:'live',addEventListener(){},stop(){this.readyState='ended';}};h.tracks.push(track);
   return {getTracks:()=>[track],getAudioTracks:()=>[track]};
  }});
  Object.defineProperty(HTMLMediaElement.prototype,'paused',{configurable:true,get(){return this.__homePaused!==false;}});
  HTMLMediaElement.prototype.play=async function(){h.plays++;if(h.blocked)throw new DOMException('Autoplay requires interaction','NotAllowedError');this.__homePaused=false;if(options.pendingAudio)await new Promise(r=>h.resolvePlayback=r);this.dispatchEvent(new Event('playing'));};
  HTMLMediaElement.prototype.pause=function(){this.__homePaused=true;this.dispatchEvent(new Event('pause'));};
  class Peer {
   constructor(){h.peers.push(this);this.connectionState='new';this.iceGatheringState='complete';}
   createDataChannel(){return this.channel={readyState:'open',sent:[],send(text){this.sent.push(JSON.parse(text));},close(){this.readyState='closed';}};}
   addTrack(){}addEventListener(){}removeEventListener(){}
   async createOffer(){return {type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'};}
   async setLocalDescription(value){this.localDescription=value;}
   async setRemoteDescription(value){this.remoteDescription=value;}
   close(){this.connectionState='closed';}
  }
  Object.defineProperty(window,'RTCPeerConnection',{configurable:true,value:Peer});
  h.emit=event=>h.peers.at(-1)?.channel.onmessage?.({data:JSON.stringify(event)});
  h.output=()=>{void h.peers.at(-1)?.ontrack?.({streams:[new MediaStream()],track:{stop(){}}});};
  h.sent=()=>h.peers.at(-1)?.channel.sent||[];
 },options);
 await page.route('**/api/status',async route=>{
  const response=await route.fetch(),data=await response.json();data.live.available=true;await route.fulfill({response,json:data});
 });
 await page.route('**/api/live/session',async route=>{await page.evaluate(()=>__homeVoice.sessions++);await route.fulfill({json:{session:{id:'home_voice_session'},transport:{type:'webrtc',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'},maxSessionMs:900000}});});
 await page.route('**/api/live/close',async route=>{await page.evaluate(()=>__homeVoice.closes++);await route.fulfill({json:{closed:true,finalization:'unconfirmed'}});});
 await page.route('**/api/live/delegate',async route=>{await page.evaluate(()=>__homeVoice.delegates++);await route.fulfill({status:500,json:{error:'No analytical call expected for a welcome'}});});
 await page.goto(base+(options.manual?'/?voice=manual':'/'));
 await page.waitForFunction(()=>window.WI_STUDIO&&window.WI_LIVE&&document.querySelectorAll('.st-signal strong').length===3);
 return page;
}
async function connected(page){
 await page.waitForFunction(()=>__homeVoice.peers.at(-1)?.remoteDescription);
 await page.evaluate(async()=>{await __homeVoice.output();__homeVoice.emit({type:'session.started',session:{id:'home_voice_session'}});});
 await page.waitForFunction(()=>window.WI_LIVE.getState().phase==='listening');
}
async function close(page){
 await page.evaluate(()=>{window.WI_LIVE.stop();__homeVoice.emit({type:'session.closed',reason:'close_requested',usage:{seconds:2}});});await page.close();
}
try {
 const home=await fixture();await connected(home);
 const geometry=await home.locator('.st-dock').evaluate(n=>{const b=n.getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left,position:getComputedStyle(n).position,width:innerWidth,height:innerHeight};});
 assert.notEqual(geometry.position,'fixed');assert.ok(geometry.top<geometry.height*.65);assert.ok(geometry.left>geometry.width*.4);assert.ok(geometry.bottom<geometry.height);
 assert.equal(await home.locator('#st-form').count(),1);assert.equal(await home.locator('#wi-live').isVisible(),false);
 assert.equal(await home.locator('.st-orb').evaluate(n=>getComputedStyle(n).animationName),'none');
 await home.screenshot({path:out+'/home-connected-1920.png',animations:'disabled'});
 pass('Conversation is the visible right-hand centerpiece at 1920×1080, with one working form and no classic panel interruption');
 await home.waitForFunction(()=>__homeVoice.sent().some(x=>/welcome|greet/i.test(x.content||'')));
 const greetings=await home.evaluate(()=>__homeVoice.sent().filter(x=>/welcome|greet/i.test(x.content||'')).length);
 await home.evaluate(()=>__homeVoice.emit({type:'session.started',session:{id:'home_voice_session'}}));
 assert.equal(await home.evaluate(()=>__homeVoice.sent().filter(x=>/welcome|greet/i.test(x.content||'')).length),greetings);
 assert.equal(await home.evaluate(()=>__homeVoice.captures),1);assert.equal(await home.evaluate(()=>__homeVoice.delegates),0);
 assert.equal(await home.locator('#wl-ai-caption,#st-caption,.vg-caption,.an-caption').count(),0);
 pass('Visible home connects without a click and welcomes once after media/session readiness, without an analytical request or spoken transcript');
 await home.locator('#st-voice').click();await home.evaluate(()=>__homeVoice.emit({type:'session.closed',reason:'close_requested',usage:{seconds:2}}));
 await home.locator('#st-home').click();await home.evaluate(()=>WI_LIVE.autostart());
 assert.equal(await home.evaluate(()=>__homeVoice.captures),1);assert.equal(await home.evaluate(()=>WI_LIVE.isActive()),false);
 assert.equal(await home.evaluate(()=>__homeVoice.tracks.every(t=>t.readyState==='ended')),true);
 pass('Stop releases the microphone and returning home does not silently reconnect');
 for(const [width,height] of [[1366,900],[768,1024],[390,844]]){
  await home.setViewportSize({width,height});assert.equal(await home.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.notEqual(await home.locator('.st-dock').evaluate(n=>getComputedStyle(n).position),'fixed');
  await home.screenshot({path:out+'/home-'+width+'.png',animations:'disabled'});
 }
 pass('Conversation remains in the home layout at laptop, tablet and phone widths without horizontal overflow');
 await home.setViewportSize({width:1920,height:1080});await home.locator('#st-question').fill('Model retention with a half-point reduction');await home.locator('.st-send').click();
 await home.waitForSelector('.st-scene');assert.equal(await home.locator('.st-dock').evaluate(n=>getComputedStyle(n).position),'fixed');
 await home.locator('#st-home').click();assert.notEqual(await home.locator('.st-dock').evaluate(n=>getComputedStyle(n).position),'fixed');
 pass('Typing still opens calculated evidence, and Home restores the centerpiece without duplicating the composer');await home.close();

 const denied=await fixture({denied:true});await denied.waitForFunction(()=>__homeVoice.captures===1&&!WI_LIVE.isActive());
 assert.equal(await denied.evaluate(()=>__homeVoice.sessions),0);assert.match(await denied.locator('#st-status').innerText(),/microphone|permission/i);
 assert.equal(await denied.locator('#st-voice').isEnabled(),true);await denied.screenshot({path:out+'/microphone-permission-1920.png',animations:'disabled'});
 pass('Denied microphone access creates no paid session and leaves a visible home retry action');await denied.close();

 const blocked=await fixture({blocked:true});await blocked.waitForFunction(()=>__homeVoice.peers.at(-1)?.remoteDescription);
 await blocked.evaluate(async()=>{await __homeVoice.output();__homeVoice.emit({type:'session.started',session:{id:'home_voice_session'}});});
 await blocked.waitForFunction(()=>WI_LIVE.getState().reason==='playback-blocked');
 assert.equal(await blocked.evaluate(()=>__homeVoice.tracks.every(t=>!t.enabled)),true);
 const enable=blocked.getByRole('button',{name:/enable audio/i});await enable.waitFor({state:'visible'});
 await blocked.screenshot({path:out+'/enable-audio-1920.png',animations:'disabled'});
 await blocked.evaluate(()=>__homeVoice.blocked=false);await enable.click();
 await blocked.waitForFunction(()=>__homeVoice.sent().some(x=>/welcome|greet/i.test(x.content||'')));
 assert.equal(await blocked.evaluate(()=>__homeVoice.sessions),1);assert.equal(await blocked.evaluate(()=>__homeVoice.tracks.every(t=>t.enabled)),true);
 pass('Blocked playback visibly offers Enable audio, mutes capture until recovery, and resumes the same session');await close(blocked);

 const awaitingAudio=await fixture({pendingAudio:true});await connected(awaitingAudio);
 await awaitingAudio.waitForFunction(()=>__homeVoice.sent().some(x=>x.type==='session.commentary.append'&&x.event_id?.startsWith('welcome_')));
 assert.equal(await awaitingAudio.evaluate(()=>__homeVoice.delegates),0);
 await awaitingAudio.evaluate(()=>__homeVoice.resolvePlayback());
 pass('The welcome starts while playback awaits first media, avoiding a circular wait for audio');await close(awaitingAudio);

 const pending=await fixture({pending:true});await pending.waitForFunction(()=>__homeVoice.captures===1);
 await pending.locator('#st-workspace').click();await pending.evaluate(()=>__homeVoice.resolveCapture());
 await pending.waitForFunction(()=>__homeVoice.tracks.length===1&&__homeVoice.tracks[0].readyState==='ended');assert.equal(await pending.evaluate(()=>__homeVoice.sessions),0);
 pass('Leaving Studio cancels an unanswered permission request and releases a late microphone result');await pending.close();

 const hidden=await fixture();await connected(hidden);
 await hidden.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await hidden.waitForFunction(()=>!WI_LIVE.isActive());assert.equal(await hidden.evaluate(()=>__homeVoice.tracks.every(t=>t.readyState==='ended')&&__homeVoice.peers.every(p=>p.connectionState==='closed')),true);
 await hidden.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await hidden.evaluate(()=>__homeVoice.captures),1);
 pass('A hidden page immediately releases media and does not silently reconnect on return');await hidden.close();

 const manual=await fixture({manual:true});await manual.waitForTimeout(300);assert.equal(await manual.evaluate(()=>__homeVoice.captures),0);await manual.close();
 pass('The explicit voice=manual link keeps the microphone off until the user starts it');
 assert.equal(externalCalls,0);assert.deepEqual(errors,[]);pass('No browser errors or external provider calls');
 await writeFile(out+'/report.json',JSON.stringify({at:new Date().toISOString(),checks,browserErrors:errors,externalProviderCalls:externalCalls,media:'Simulated permissions, WebRTC and playback; physical hardware not tested'},null,2));
} finally {
 for(const page of pages)if(!page.isClosed())await page.close();await browser.close();await new Promise(r=>server.close(r));
 if(!resolve(storageDir).startsWith(resolve(tmpdir())+sep))throw Error('Unexpected temporary directory');await rm(storageDir,{recursive:true,force:true});
}
