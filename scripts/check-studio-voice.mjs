// Browser integration checks for the real voice UI. Media and provider protocol
// are simulated explicitly; this never opens a physical microphone or API call.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from '../server.mjs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = 'docs/studio-voice';
await mkdir(output, { recursive: true });
const storageDir = await mkdtemp(join(tmpdir(), 'chro-studio-voice-'));
let externalCalls = 0;
const server = createServer({ apiKey: '', storageDir, fetchImpl: () => { externalCalls++; throw Error('Unexpected external provider call'); } });
await server.ready;
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHRO_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const checks = [], browserErrors = [];
const record = name => { checks.push(name); console.log('PASS', name); };
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

async function fixture({ denied = false, studio = false } = {}) {
 const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
 page.on('pageerror', error => browserErrors.push(error.message));
 let expired = false, sessionCalls = 0, delegateCalls = 0;
 await page.addInitScript(({ denied, sdp }) => {
  const harness = window.__voiceHarness = { captureCalls: 0, tracks: [], peers: [], events: [] };
  for (const type of ['wi-voice-state', 'wi-voice-answer', 'wi-voice-beat', 'wi-voice-transcript']) window.addEventListener(type, event => harness.events.push({ type, detail: event.detail }));
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
   harness.captureCalls++;
   if (denied) throw new DOMException('Browser verification: denied microphone permission', 'NotAllowedError');
   const track = { enabled: true, readyState: 'live', addEventListener() {}, stop() { this.readyState = 'ended'; } };
   harness.tracks.push(track);
   return { getTracks: () => [track], getAudioTracks: () => [track] };
  } });
  class Peer {
   constructor() { harness.peers.push(this); this.connectionState = 'new'; this.iceGatheringState = 'complete'; }
   createDataChannel() {
    this.channel = { readyState: 'open', sent: [], send(text) { this.sent.push(JSON.parse(text)); }, close() { this.readyState = 'closed'; } };
    return this.channel;
   }
   addTrack() {}
   async createOffer() { return { type: 'offer', sdp }; }
   async setLocalDescription(value) { this.localDescription = value; }
   async setRemoteDescription(value) { this.remoteDescription = value; }
   close() { this.connectionState = 'closed'; }
   addEventListener() {}
   removeEventListener() {}
  }
  Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: Peer });
  harness.emit = event => harness.peers.at(-1)?.channel.onmessage?.({ data: JSON.stringify(event) });
  harness.commentary = () => harness.peers.at(-1)?.channel.sent.filter(event => event.type === 'session.commentary.append' && !event.event_id?.startsWith('welcome_')) || [];
 }, { denied, sdp });
 await page.route('**/api/status', async route => {
  if (expired) { await route.fulfill({ status: 401, json: { error: 'Sign in to the workspace first.' } }); return; }
  const response = await route.fetch(), data = await response.json();
  data.live.available = true;
  await route.fulfill({ response, json: data });
 });
 await page.route('**/api/live/session', async route => {
  sessionCalls++;
  await route.fulfill({ json: { session: { id: 'browser_voice_session' }, transport: { type: 'webrtc', sdp }, maxSessionMs: 900000 } });
 });
 await page.route('**/api/live/close', route => route.fulfill({ json: { closed: true, finalization: 'unconfirmed' } }));
 await page.route('**/api/live/delegate', async route => {
  delegateCalls++;
  const request = route.request().postDataJSON();
  // Exercise the real local calculation and presentation path; only transport is mocked.
  const answerResponse = await page.request.post(base + '/api/ask', { data: { question: request.question, scope: request.scope, context: request.context, history: request.history } });
  assert.equal(answerResponse.status(), 200);
  const response = await answerResponse.json();
  const content = ['Synthetic data. The first-year retention evidence is on screen.', 'The fixed cohort contains 1,200 hires and 168 first-year exits.', 'The modeled scenario is conditional and does not establish a causal effect.'];
  const events = content.map((text, index) => ({ type: 'session.commentary.append', event_id: `browser_beat_${delegateCalls}_${index}`, delegation_id: request.delegationId, content: text }));
  await route.fulfill({ json: { sessionId: request.sessionId, delegationId: request.delegationId, response, event: events[0], events, narration: { mode: 'verified-beats', count: events.length, synchronization: 'transcript-estimate' } } });
 });
 await page.goto(base + (studio ? '/?voice=manual' : '/?workspace=1&voice=manual'));
 await page.waitForFunction(() => window.WI_LIVE && window.WI_CONVERSATION && !document.querySelector('#wl-start').disabled);
 await page.evaluate(() => window.WI_LIVE.open());
 return {
  page,
  expire: () => { expired = true; },
  counts: () => ({ sessionCalls, delegateCalls }),
  async start() {
   await page.locator('#wl-start').click();
   await page.waitForFunction(() => window.__voiceHarness.peers.at(-1)?.remoteDescription);
   await page.evaluate(() => window.__voiceHarness.emit({ type: 'session.started', session: { id: 'browser_voice_session' } }));
   await page.waitForFunction(() => document.querySelector('#wl-state').textContent.startsWith('Connected.'));
  },
  async ask(id, offset = 900) {
   await page.evaluate(({ id, offset }) => {
    window.__voiceHarness.emit({ type: 'session.input_transcript.delta', delta: 'What is first-', start_ms: offset - 700, end_ms: offset - 400 });
    window.__voiceHarness.emit({ type: 'session.input_transcript.delta', delta: 'year retention?', start_ms: offset - 400, end_ms: offset - 100 });
    window.__voiceHarness.emit({ type: 'session.delegation.created', offset_ms: offset, delegation: { id, target: 'client' } });
   }, { id, offset });
   await page.waitForFunction(id => window.__voiceHarness.commentary().some(event => event.delegation_id === id), id);
  },
  async close() {
   await page.evaluate(() => window.__voiceHarness.emit({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 2 } }));
   await page.close();
  }
 };
}

try {
 const denied = await fixture({ denied: true });
 assert.equal(await denied.page.evaluate(() => window.__voiceHarness.captureCalls), 0);
 await denied.page.locator('#wl-start').click();
 await denied.page.waitForFunction(() => document.querySelector('#wl-state').textContent.includes('permission was denied'));
 assert.equal(await denied.page.evaluate(() => window.WI_LIVE.isActive()), false);
 assert.equal(await denied.page.locator('#wl-start').isEnabled(), true);
 assert.equal(await denied.page.locator('#wl-stop').isDisabled(), true);
 assert.match(await denied.page.locator('#wl-mic').innerText(), /off/i);
 assert.deepEqual(denied.counts(), { sessionCalls: 0, delegateCalls: 0 });
 await denied.page.locator('#wi-live').screenshot({ path: output + '/microphone-denied.png' });
 await denied.page.locator('#wl-start').click();
 await denied.page.waitForFunction(() => window.__voiceHarness.captureCalls === 2);
 await denied.page.close();
 record('Microphone denial releases voice state, creates no session, and permits retry');

 const expired = await fixture(); expired.expire();
 await expired.page.locator('#wl-start').click();
 await expired.page.waitForFunction(() => !document.querySelector('#wl-signin').hidden);
 assert.equal(await expired.page.evaluate(() => window.__voiceHarness.captureCalls), 0);
 assert.equal(await expired.page.evaluate(() => window.WI_LIVE.isActive()), false);
 assert.deepEqual(expired.counts(), { sessionCalls: 0, delegateCalls: 0 });
 assert.match(await expired.page.locator('#wl-state').innerText(), /Reload this page and sign in again/);
 await expired.page.locator('#wi-live').screenshot({ path: output + '/sign-in-expired.png' });
 await expired.page.close();
 record('Expired authentication is detected before microphone capture or voice-session allocation');

 const active = await fixture({ studio: true }); await active.start(); await active.ask('browser_first');
 assert.equal(await active.page.evaluate(() => window.__voiceHarness.commentary().length), 1);
 await active.page.evaluate(() => window.__voiceHarness.emit({ type: 'session.commentary.appended', client_event_id: 'foreign_event' }));
 assert.equal(await active.page.evaluate(() => window.__voiceHarness.commentary().length), 1);
 await active.page.evaluate(() => window.__voiceHarness.emit({ type: 'session.commentary.appended', client_event_id: 'browser_beat_1_0' }));
 await active.page.waitForFunction(() => window.__voiceHarness.commentary().length === 2);
 const speakingBeforeTranscript = await active.page.evaluate(() => window.__voiceHarness.events.some(event => event.type === 'wi-voice-state' && event.detail.phase === 'speaking'));
 assert.equal(speakingBeforeTranscript, false, 'An acknowledgement must not be labeled audible playback');
 await active.page.evaluate(() => window.__voiceHarness.emit({ type: 'session.output_transcript.delta', delta: 'The first-year retention evidence VOICE_ONLY_PROBE_NO_CAPTIONS', start_ms: 1100, end_ms: 1700 }));
 await active.page.waitForFunction(() => window.__voiceHarness.events.some(event => event.type === 'wi-voice-state' && event.detail.phase === 'speaking'));
 assert.equal(await active.page.evaluate(() => window.__voiceHarness.events.find(event => event.type === 'wi-voice-answer').detail.beatCount), 3);
 assert.equal(await active.page.evaluate(() => window.__voiceHarness.events.filter(event => event.type === 'wi-voice-transcript' && event.detail.role === 'user').at(-1).detail.utteranceText), 'What is first-year retention?');
 assert.equal(await active.page.evaluate(() => window.WI_STUDIO.active), true);
 assert.match(await active.page.locator('#st-stage h1').innerText(), /First-year exit rate/i);
 assert.equal(await active.page.locator('.st-fact[aria-current="true"]').count(), 1);
 assert.equal(await active.page.locator('#st-caption,.an-caption,.vg-caption,#wl-ai-caption').count(), 0);
 assert.equal(await active.page.evaluate(() => document.body.innerText.includes('VOICE_ONLY_PROBE_NO_CAPTIONS')), false, 'assistant speech must not appear in visible captions');
 assert.equal(await active.page.evaluate(() => window.__voiceHarness.events.some(event => event.type === 'wi-voice-transcript' && event.detail.role === 'assistant' && event.detail.text.includes('VOICE_ONLY_PROBE_NO_CAPTIONS'))), true, 'internal assistant transcript events still support evidence focus');
 await active.page.locator('#wi-live').screenshot({ path: output + '/verified-narration.png' });
 record('Studio accepts the real visual answer and highlights its evidence; narration advances only after its matching injection acknowledgement');

 await active.page.evaluate(() => {
  window.__voiceHarness.emit({ type: 'session.input_transcript.delta', delta: 'Actually compare the current context', start_ms: 2000, end_ms: 2400 });
  window.__voiceHarness.emit({ type: 'session.commentary.appended', client_event_id: 'browser_beat_1_1' });
 });
 assert.equal(await active.page.evaluate(() => window.__voiceHarness.commentary().length), 2);
 record('New speech cancels remaining narration; late acknowledgements cannot send stale beats');

 // A new question is valid after interruption. Manual scope changes invalidate
 // its pending spoken updates and produce an explicit conversation redirect.
 await active.ask('browser_second', 3300);
 assert.equal(await active.page.evaluate(() => window.__voiceHarness.commentary().length), 3);
 await active.page.evaluate(() => {
  document.getElementById('wi-app').__WI_APP.state.region = 'EMEA';
  window.dispatchEvent(new Event('wi-context-changed'));
  window.__voiceHarness.emit({ type: 'session.commentary.appended', client_event_id: 'browser_beat_2_0' });
 });
 assert.equal(await active.page.evaluate(() => window.__voiceHarness.commentary().length), 3);
 assert.equal(await active.page.evaluate(() => window.__voiceHarness.peers.at(-1).channel.sent.some(event => event.type === 'session.instructions.append' && event.content.includes('Stop the previous explanation'))), true);
 await active.page.locator('#wl-stop').click();
 assert.equal(await active.page.evaluate(() => window.__voiceHarness.tracks.every(track => !track.enabled)), true);
 await active.page.evaluate(() => window.__voiceHarness.emit({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 2 } }));
 assert.equal(await active.page.evaluate(() => window.__voiceHarness.tracks.every(track => track.readyState === 'ended')), true);
 assert.equal(await active.page.evaluate(() => window.__voiceHarness.peers.every(peer => peer.connectionState === 'closed')), true);
 assert.equal(await active.page.evaluate(() => window.WI_LIVE.isActive()), false);
 await active.page.close();
 record('Scope change cancels stale narration, and final Stop releases microphone tracks and peer transport');

 assert.equal(externalCalls, 0);
 assert.deepEqual(browserErrors, []);
 record('No browser JavaScript errors or external provider requests');
 await writeFile(output + '/report.json', JSON.stringify({ at: new Date().toISOString(), browser: await browser.version(), checks, browserErrors, externalProviderCalls: externalCalls, physicalMicrophoneTested: false, actualAudioPlaybackTested: false, protocol: 'Browser transport and microphone simulated; local question calculations and UI exercised' }, null, 2));
} finally {
 await browser.close();
 await new Promise(resolve => server.close(resolve));
 await server.whenClosed();
 await rm(storageDir, { recursive: true, force: true });
}
