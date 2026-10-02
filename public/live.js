/* GPT-Live WebRTC client delegation. No private key or upstream URL enters the browser. */
(() => {
 'use strict';
 const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
 const snapshot = value => freeze(structuredClone(value));
 const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
 function timeline() {
  let entries = [], seen = new Set();
  return {
   add(event) {
    const role = event.type === 'session.input_transcript.delta' ? 'user' : event.type === 'session.output_transcript.delta' ? 'assistant' : null;
    if (!role || typeof event.delta !== 'string' || !event.delta.length || event.delta.length > 8000 || !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms) || event.start_ms < 0 || event.end_ms < event.start_ms || (event.event_id && seen.has(event.event_id))) return false;
    if (event.event_id) seen.add(event.event_id);
    if (seen.size > 1200) seen.delete(seen.values().next().value);
    entries.push(Object.freeze({ role, text: event.delta, start: event.start_ms, end: event.end_ms }));
    if (entries.length > 400) entries.shift();
    return true;
   },
   text(role, after = -1, through = Infinity) { return entries.filter(e => e.role === role && e.end > after && e.start <= through).sort((a, b) => a.start - b.start || a.end - b.end).map(e => e.text).join(''); },
   entries() { return entries.slice(); }
  };
 }
 const bytes = value => new TextEncoder().encode(value).length;
 function matches(result, sessionId, delegationId, recovery = false) {
  if ((result?.recovery === true) !== recovery) return false;
  const valid = event => event?.type === 'session.commentary.append' && event.delegation_id === (recovery ? null : delegationId) && typeof event.content === 'string' && event.content.length > 0 && event.content.length < 2000 && validId(event.event_id);
  if (result?.sessionId !== sessionId || result?.delegationId !== delegationId || !valid(result?.event) || !result.response || typeof result.response.answer !== 'string') return false;
  if (result.events == null) return true; // A previously deployed server may return only event.
  return Array.isArray(result.events) && result.events.length > 0 && result.events.length <= 8 && result.events.every(event => valid(event) && bytes(event.content) <= 450) && new Set(result.events.map(event => event.event_id)).size === result.events.length && result.events[0].event_id === result.event.event_id && result.events[0].content === result.event.content;
 }
 // Pure helpers also used by the protocol tests; no transport starts on page load.
 window.WI_LIVE_PROTOCOL = Object.freeze({ timeline, matches, snapshot });
 const host = document.getElementById('wi-live');
 if (!host) return;
 host.hidden = true;
 host.innerHTML = `<section class="wl-panel" aria-labelledby="wl-heading">
  <div class="wl-header"><div><span class="wl-eyebrow">SYNTHETIC WORKFORCE INTELLIGENCE</span><h2 id="wl-heading">Talk through the evidence</h2><p>Speak naturally, interrupt, and explore the current dashboard with an AI voice.</p></div><div class="wl-header-actions"><span id="wl-mic" class="wl-mic">Microphone off</span><button type="button" id="wl-close">Close panel</button></div></div>
  <div class="wl-controls"><button type="button" id="wl-start">Start conversation</button><button type="button" id="wl-stop" disabled>Stop</button><button type="button" id="wl-mute" aria-pressed="false" disabled>Mute microphone</button></div>
  <p id="wl-state" role="status" aria-live="polite">Checking continuous voice availability…</p><button type="button" id="wl-signin" hidden>Reload and sign in again</button>
  <div class="wl-details"><span id="wl-usage">Voice duration: —</span><span id="wl-playback">Speaker idle</span></div>
  <audio id="wl-audio" controls aria-label="Live AI voice playback"></audio>
  <p class="wl-note">AI-generated voice · all workforce figures are synthetic. Spoken wording and speech recognition can be imperfect; the evidence card contains the calculated result. Microphone audio streams while active. Mute keeps the paid session open; Stop ends it. Sessions stop after 15 minutes.</p>
  <details id="wl-help" class="wl-help"><summary>Connection help <span id="wl-version"></span></summary><p>The browser media test checks recording on this computer. This separate check asks the server to reach the OpenAI model-metadata endpoint; it does not start a voice session or generate audio.</p><div class="wl-controls"><button type="button" id="wl-check">Check API connection</button><button type="button" id="wl-report">Download connection report</button></div><p id="wl-diagnostic-state" role="status" aria-live="polite">The report contains error categories and runtime metadata. It excludes API keys, audio, transcripts and workforce records.</p></details>
  <details class="wl-transcripts"><summary>Live transcript — approximate, may contain errors</summary><div class="wl-caption-grid"><div><h3>You</h3><p id="wl-user-caption">Your speech will appear here.</p></div><div><h3>AI voice</h3><p id="wl-ai-caption">Spoken captions will appear here.</p></div></div></details>
  <p id="wl-result" class="wl-result" aria-live="polite">Ask about a metric or a scenario. Validated answers also update the visual briefing.</p>
 </section>`;
 const $ = selector => host.querySelector(selector);
 let available = false, serial = 0, active = null, closing = false, panelOpen = false, checking = false, lastClientFailure = null;
 let toggle = null;
 if (document.createElement) {
  toggle = document.createElement('button'); toggle.id = 'wl-toggle'; toggle.type = 'button'; toggle.className = 'wi-btn wl-toggle';
  toggle.textContent = 'Continuous voice'; toggle.setAttribute('aria-controls','wi-live'); toggle.setAttribute('aria-expanded','false');
  const anchor = document.getElementById('wi-app')?.querySelector?.('#wi-present');
  if (anchor?.before) anchor.before(toggle); else host.before?.(toggle);
  toggle.addEventListener('click',() => panelOpen ? closePanel() : openPanel());
 }
 const state = message => { $('#wl-state').textContent = message; if (toggle) toggle.title = message; };
 const api = () => window.WI_CONVERSATION;
 const scope = () => api()?.getScope?.() || { function: window.WI_APP?.state?.function || 'all', region: window.WI_APP?.state?.region || 'all', period: window.WI_APP?.state?.period || 'quarter' };
 const context = () => api()?.getContext?.() || {};
 const attachedImage = () => window.WI_STUDIO?.getImage?.() || null;
 const audience = () => window.WI_STUDIO?.getAudience?.() || 'chro';
 const history = () => (api()?.getHistory?.() || []).slice(-24).map(x => ({ role: x.role, text: String(x.text || '').slice(0,2000) }));
 const current = run => active === run && run.serial === serial;
 function notify(type, detail) { window.dispatchEvent(new CustomEvent(type, { detail: snapshot(detail) })); }
 function phase(run, value, detail = {}) {
  if (run && run.phase === value && !Object.keys(detail).length) return;
  if (run) run.phase = value;
  notify('wi-voice-state', { phase: value, turnId: run?.turnId || null, ...detail });
 }
 function clearBeats(run) { clearTimeout(run.beatTimer); run.beatTimer = null; run.beats = null; }
 function clearRecovery(run) { clearTimeout(run.recoveryTimer); run.recoveryTimer = null; run.recoveryNeeded = false; }
 function sendBeat(run) {
  const queue = run.beats;
  if (!queue || !current(run) || closing || queue.revision !== run.inputRevision || queue.scope !== JSON.stringify(scope())) { clearBeats(run); return; }
  const event = queue.events[queue.index];
  if (!event) { clearBeats(run); return; }
  if (!send(run, event)) { clearBeats(run); return; }
  notify('wi-voice-beat', { turnId: run.turnId, index: queue.index, total: queue.events.length, status: 'submitted', cue:queue.cues?.[queue.index] || null });
  run.beatTimer = setTimeout(() => {
   if (run.beats !== queue || !current(run)) return;
   clearBeats(run);
   $('#wl-result').textContent = 'The visual answer is ready. Voice has not acknowledged the remaining explanation; ask again if needed.';
  }, 15000);
 }
 function acceptBeat(run, event) {
  const queue = run.beats;
  if (!queue || event.client_event_id !== queue.events[queue.index]?.event_id) return;
  clearTimeout(run.beatTimer);
  // An append acknowledgement confirms context injection, not spoken playback.
  notify('wi-voice-beat', { turnId: run.turnId, index: queue.index, total: queue.events.length, status: 'accepted', cue:queue.cues?.[queue.index] || null });
  queue.index++;
  sendBeat(run);
 }
 function controls() {
  $('#wl-start').disabled = !available || !!active || closing; $('#wl-stop').disabled = !active || closing; $('#wl-mute').disabled = !active?.ready || closing;
  $('#wl-check').disabled = !!active || checking;
  if (toggle) { toggle.textContent = closing ? 'Continuous voice · finishing' : active?.ready ? '● Continuous voice · active' : active ? 'Continuous voice · connecting' : 'Continuous voice'; toggle.classList.toggle('wl-toggle-active',!!active); }
 }
 function openPanel() {
  panelOpen = true; host.hidden = false; toggle?.setAttribute('aria-expanded','true');
  ($('#wl-start').disabled ? $('#wl-close') : $('#wl-start')).focus?.({preventScroll:true});
 }
 function closePanel() {
  stop('Closing voice panel. Finishing conversation…'); panelOpen = false; host.hidden = true; toggle?.setAttribute('aria-expanded','false'); toggle?.focus?.({preventScroll:true});
 }
 function micStatus(run) {
  const track = run?.stream?.getAudioTracks()[0], isActive = !!track && track.readyState === 'live' && track.enabled;
  $('#wl-mic').textContent = isActive ? '● Microphone active' : track?.readyState === 'live' ? 'Microphone muted locally' : 'Microphone off';
  $('#wl-mic').classList.toggle('wl-mic-active', isActive);
  $('#wl-mute').setAttribute('aria-pressed', String(!!run?.muted));
  $('#wl-mute').textContent = run?.muted ? 'Unmute microphone' : 'Mute microphone';
 }
 function send(run, event) { if (!current(run) || !run.ready || run.channel?.readyState !== 'open') return false; run.channel.send(JSON.stringify(event)); return true; }
 function command(run, type, extra = {}) { return send(run, { type, event_id: `ui_${crypto.randomUUID()}`, ...extra }); }
 function reportUsage(run, final = false) { $('#wl-usage').textContent = `Voice duration: ${Number.isFinite(run.seconds) ? run.seconds.toFixed(1) + ' s' : 'unavailable'} · ${final ? 'final' : 'latest observed; not final'}`; }
 function release(run) {
  window.WI_VOICE_GUIDE?.stop();
  clearBeats(run);
  clearRecovery(run);
  clearTimeout(run.startTimer); clearTimeout(run.closeTimer); clearTimeout(run.maxTimer); clearTimeout(run.disconnectTimer); clearTimeout(run.delegationTimer);
  run.pending?.abort(); run.startControl?.abort(); run.stream?.getTracks().forEach(track => track.stop());
  if (run.channel) { run.channel.onmessage = run.channel.onclose = run.channel.onerror = null; try { run.channel.close(); } catch {} }
  if (run.pc) { run.pc.ontrack = run.pc.onconnectionstatechange = null; try { run.pc.close(); } catch {} }
  if (current(run)) { const audio = $('#wl-audio'); audio.pause(); audio.srcObject = null; active = null; closing = false; micStatus(null); controls(); $('#wl-playback').textContent = 'Speaker stopped'; }
 }
 async function serverClose(id, beacon = false) {
  if (!validId(id)) return;
  const body = JSON.stringify({ sessionId: id });
  if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/live/close', new Blob([body], { type: 'application/json' })); return; }
  try { await fetch('/api/live/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, signal: AbortSignal.timeout(10000) }); } catch { /* Finalization stays unconfirmed without session.closed. */ }
 }
 function failed(run, message) {
  if (!current(run)) return;
  lastClientFailure = {at:new Date().toISOString(),stage:run.stage,sessionAcknowledged:!!run.sessionId,sessionStarted:run.ready,
   code:run.failureCode || null,diagnosticId:run.diagnosticId || null,
   peerConnectionState:['new','connecting','connected','disconnected','failed','closed'].includes(run.pc?.connectionState)?run.pc.connectionState:null};
  $('#wl-help').open = true;
  const finalization = run.sessionId ? 'Final session usage is unconfirmed.' : run.sessionRequested ? 'Voice startup and final session usage are unconfirmed.' : 'Voice setup did not reach the server.';
  state(message + ' Microphone released. ' + finalization); reportUsage(run);
  $('#wl-signin').hidden = run.failureCode !== 'HTTP_401';
  phase(run, 'error', { code: run.failureCode || null, message });
  if (!run.sessionId) $('#wl-usage').textContent = 'Voice duration: unavailable · session startup not confirmed';
  release(run); void serverClose(run.sessionId);
 }
 async function diagnosticRequest(path, options = {}) {
  const response = await fetch(path,{...options,signal:AbortSignal.timeout(15000)});
  let data; try { data = await response.json(); } catch { throw Error('The server did not return a connection report. Confirm it is running, then refresh this page.'); }
  if (!response.ok) throw Error(response.status === 401 ? 'Sign in to the workspace again, then retry.' : data.error || 'The connection report could not be retrieved.');
  if (data.schema !== 'workforce-connection-report.v1') throw Error('Restart the server with app version 2.0.1 or later, then refresh this page.');
  return data;
 }
 async function checkConnection() {
  if (active || checking) return;
  checking = true; controls(); $('#wl-diagnostic-state').textContent = 'Checking the server’s API connection…';
  try {
   const report = await diagnosticRequest('/api/diagnostics/connection',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   const check = report.lastConnectionCheck;
   $('#wl-diagnostic-state').textContent = (check?.error?.category ? check.error.category + ': ' : '') + (check?.message || 'Check complete. Download the connection report for details.');
  } catch (error) { $('#wl-diagnostic-state').textContent = error.message || 'The connection check could not finish.'; }
  finally { checking = false; controls(); }
 }
 async function downloadReport() {
  $('#wl-report').disabled = true;
  try {
   const report = await diagnosticRequest('/api/diagnostics');
   report.browser = {secureContext:window.isSecureContext === true,webRTCAvailable:typeof window.RTCPeerConnection === 'function',microphoneAPIAvailable:typeof navigator.mediaDevices?.getUserMedia === 'function',online:navigator.onLine !== false,lastVoiceFailure:lastClientFailure};
   const url = URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
   const link = document.createElement('a'); link.href = url; link.download = 'workforce-connection-report.json';
   document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
   $('#wl-diagnostic-state').textContent = 'Downloaded workforce-connection-report.json. Attach this report if voice still fails. It contains no API keys, audio or transcripts.';
  } catch (error) { $('#wl-diagnostic-state').textContent = error.message || 'Could not download the connection report.'; }
  finally { $('#wl-report').disabled = false; }
 }
 function stop(reason = 'Finishing conversation…') {
  window.WI_VOICE_GUIDE?.stop();
  const run = active; if (!run || closing) return;
  clearBeats(run); phase(run, 'stopped');
  closing = true; run.pending?.abort(); clearTimeout(run.delegationTimer); run.delegationTimer = null; clearRecovery(run);
  $('#wl-audio').pause();
  run.stream?.getTracks().forEach(track => { track.enabled = false; }); run.muted = true; micStatus(run); controls();
  if (run.ready && run.channel?.readyState === 'open') {
   state(reason); command(run, 'session.close');
   run.closeTimer = setTimeout(() => failed(run, 'No session.closed event arrived before the close timeout.'), 15000);
  } else { failed(run, 'Connection setup was cancelled.'); }
 }
 function cancelPending(run) {
  if (!run.pending) return;
  run.pending.abort(); run.pending = null;
  run.recoveryNeeded = true;
  $('#wl-result').textContent = 'Listening to your continued question. The earlier result will not replace the current view.';
  command(run, 'session.thinking.append', { delegation_id: null, content: 'The user continued speaking. The application will discard the earlier result and investigate the complete updated question after speech settles. No new result is verified yet.' });
 }
 function scheduleRecovery(run) {
  clearTimeout(run.recoveryTimer);
  if (!run.recoveryNeeded || !current(run) || closing) return;
  const revision = run.inputRevision, order = run.delegationOrder;
  run.recoveryTimer = setTimeout(() => {
   run.recoveryTimer = null;
   if (!current(run) || closing || !run.recoveryNeeded || revision !== run.inputRevision || order !== run.delegationOrder) return;
   if (run.recoveryAttempts >= 2) {
    run.recoveryNeeded = false;
    $('#wl-result').textContent = 'Voice could not settle this request after two recovery attempts. Please repeat the complete question or type it below.';
    phase(run, 'listening', { reason: 'recovery-exhausted', message: $('#wl-result').textContent });
    command(run, 'session.instructions.append', { delegation_id: null, content: 'The application stopped automatic recovery after repeated changes. No result is verified. Ask the caller to repeat the complete question or type it; do not keep saying that you are checking.' });
    return;
   }
   const through = run.transcript.entries().filter(entry => entry.role === 'user' && entry.end > run.answeredOffset).reduce((end, entry) => Math.max(end, entry.end), -1);
   if (through < 0) { run.recoveryNeeded = false; return; }
   run.recoveryAttempts++;
   void delegated(run, { offset_ms: through, delegation: { id: `recovery_${crypto.randomUUID()}`, target: 'client' } }, true);
  }, 900);
 }
 function syncContext(event) {
  const run = active; if (!run?.ready || closing) return;
  const selected = context(), values = { scope: scope(), metric: selected.metricId || null, scenario: selected.caseId || null, audience:audience() };
  const key = JSON.stringify(values);
  // An explicit application navigation/question event invalidates pending work
  // even when it keeps the same filters (for example Home or a typed follow-up).
  const forced = event?.type === 'wi-context-changed' || event?.force === true;
  if (key === run.contextKey && !forced) return;
  const changed = !!run.contextKey || forced; run.contextKey = key;
  if (changed) {
   run.pending?.abort(); run.pending = null; ++run.delegationOrder; clearTimeout(run.delegationTimer); run.delegationTimer = null; clearRecovery(run); clearBeats(run); window.WI_VOICE_GUIDE?.stop();
   run.answeredOffset = run.transcript.entries().filter(entry => entry.role === 'user').reduce((end, entry) => Math.max(end, entry.end), run.answeredOffset);
   run.delegationOffset = null; run.recoveryAttempts = 0;
   command(run, 'session.instructions.append', { delegation_id: null, content: 'The user changed the question or dashboard selection. Stop the previous explanation and use the latest selection for the next question. Earlier pending results have been discarded.' });
   phase(run, 'listening', { reason: 'context-changed' });
  }
  const content = 'Current synthetic dashboard selection: ' + key + '. Use this to understand references; delegate all requested facts and calculations.';
  if (bytes(content) <= 450) command(run, 'session.thinking.append', { delegation_id: null, content });
 }
 async function delegated(run, event, recovery = false) {
  const delegationId = event.delegation?.id;
  if (!current(run) || closing || !validId(delegationId) || event.delegation?.target !== 'client' || run.seenDelegations.has(delegationId)) return;
  if (!Number.isFinite(event.offset_ms) || event.offset_ms < 0) return;
  if (event.offset_ms <= run.answeredOffset) return;
  run.seenDelegations.add(delegationId); run.pending?.abort(); clearTimeout(run.delegationTimer); run.delegationTimer = null; clearRecovery(run); clearBeats(run); run.delegationOffset = event.offset_ms;
  if (!recovery) run.recoveryAttempts = 0;
  run.turnId = delegationId; phase(run, 'thinking');
  const order = ++run.delegationOrder;
  // Metadata carries no utterance. A short drain lets already-in-flight transcript
  // fragments arrive; it is not a claim that a transcript turn is complete.
  const execute = async () => {
   run.delegationTimer = null;
   if (!current(run) || closing || order !== run.delegationOrder) return;
    const question = run.transcript.text('user', run.answeredOffset, event.offset_ms).trim();
    // A transcript delta can start before the delegation offset and end after
    // it. Its whole text belongs to this question; consume that same span when
    // the result succeeds so the final word cannot leak into the next turn.
    const questionThrough = run.transcript.entries().filter(entry => entry.role === 'user' && entry.end > run.answeredOffset && entry.start <= event.offset_ms).reduce((end, entry) => Math.max(end, entry.end), event.offset_ms);
   if (!question && run.answeredOffset >= 0) { phase(run, 'listening'); return; }
   const providerId = recovery ? null : delegationId;
   if (!question || question.length > 2000) {
    command(run, 'session.commentary.append', { delegation_id: providerId, content: 'I could not safely assemble that question from the speech transcript. Please ask a short, specific metric or scenario question again.' });
    $('#wl-result').textContent = 'Transcript was incomplete or too long. Please repeat a short question.'; return;
   }
   const revision = run.inputRevision, ctrl = new AbortController(); run.pending = ctrl;
   const scopeAtStart = JSON.stringify(scope()), contextAtStart = JSON.stringify(context()), imageAtStart=attachedImage(), audienceAtStart=audience();
   $('#wl-result').textContent = 'Investigating your question across the available evidence…';
   phase(run,'thinking',{message:'Investigating your question across the available evidence. You can interrupt to change direction.'});
   command(run,'session.thinking.append',{delegation_id:providerId,content:'The backend analyst is investigating the question. No result is verified yet. Briefly acknowledge the lookup if useful, then wait for the verified explanation; do not invent progress or findings.'});
   try {
    const res = await fetch('/api/live/delegate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(110000)]), body: JSON.stringify({ sessionId: run.sessionId, delegationId, ...(recovery ? { recovery: true } : {}), question, scope: scope(), context: context(), history: history(), audience:audienceAtStart, sourceVersion:window.WI_DATA?.sourceVersion, ...(imageAtStart?{image:imageAtStart}:{}) }) });
    if (!res.ok) { let error; try { error = (await res.json()).error; } catch {} if (res.status === 401) { run.failureCode = 'HTTP_401'; failed(run, 'Your workspace sign-in expired. Reload this page and sign in again to continue voice.'); return; } throw Error(error || `Evidence lookup failed (${res.status}).`); }
    const value = await res.json();
    if (!current(run) || closing || ctrl.signal.aborted || revision !== run.inputRevision || order !== run.delegationOrder || scopeAtStart !== JSON.stringify(scope()) || contextAtStart !== JSON.stringify(context()) || imageAtStart?.dataUrl !== attachedImage()?.dataUrl || audienceAtStart!==audience()) return;
    if (!matches(value, run.sessionId, delegationId, recovery)) throw Error('The evidence response did not match this conversation.');
    const result = snapshot(value);
    if (!api()?.showResponse) throw Error('The visual briefing is unavailable.');
    const shown = await api().showResponse(result.response, { origin: 'voice', isCurrent: () => current(run) && !closing && !ctrl.signal.aborted && revision === run.inputRevision && order === run.delegationOrder && scopeAtStart === JSON.stringify(scope()) && imageAtStart?.dataUrl === attachedImage()?.dataUrl && audienceAtStart===audience() });
    if (!current(run) || closing || ctrl.signal.aborted || revision !== run.inputRevision || order !== run.delegationOrder) return;
    if (shown === false) throw Error('The data changed during this lookup. Ask again to use the latest evidence.');
     run.answeredOffset = questionThrough;
    run.recoveryAttempts = 0;
    $('#wl-result').textContent = 'Validated visual briefing: ' + result.response.title + '. Exact figures and scenario assumptions appear in the evidence card.';
    window.WI_VOICE_GUIDE?.prepare(result.response);
    run.contextKey = JSON.stringify({ scope: scope(), metric: context().metricId || null, scenario: context().caseId || null, audience:audience() });
    notify('wi-voice-answer', { response: result.response, turnId: delegationId, beatCount: result.events?.length || 1, narration:result.narration || null });
    run.beats = { events: result.events || [result.event], cues:result.narration?.beats, index: 0, revision, scope: JSON.stringify(scope()) };
    sendBeat(run);
   } catch (error) {
    if (!current(run) || closing || ctrl.signal.aborted || order !== run.delegationOrder) return;
    $('#wl-result').textContent = error.message || 'Evidence lookup failed. Please try again.';
    phase(run, 'listening', { reason: 'evidence-error', message: $('#wl-result').textContent });
    command(run, 'session.commentary.append', { delegation_id: providerId, content: 'The evidence lookup did not complete. No new result is verified. Please ask again.' });
   } finally { if (run.pending === ctrl) run.pending = null; }
  };
  if (recovery) void execute(); else run.delegationTimer = setTimeout(execute, 300);
 }
 function eventReceived(run, event) {
  if (!current(run)) return;
  if (event.type === 'session.started') {
   if (run.sessionId && event.session?.id && event.session.id !== run.sessionId) { failed(run, 'Session identity mismatch.'); return; }
   run.ready = true; run.stage = 'voice.conversation'; clearTimeout(run.startTimer); controls(); state('Connected. You can speak and interrupt naturally.');
   command(run, 'session.instructions.append', { delegation_id: null, content: 'Greet the caller now in English. Introduce yourself briefly as their AI workforce collaborator using synthetic data. Offer to find a priority, compare teams, or model a decision; then listen. Delegate all business facts and follow-ups.' });
   syncContext(); phase(run, 'listening');
  } else if (event.type === 'session.closed') {
   if (Number.isFinite(event.usage?.seconds) && event.usage.seconds >= 0) run.seconds = event.usage.seconds;
   reportUsage(run, Number.isFinite(event.usage?.seconds));
   state(`Conversation ended (${String(event.reason || 'closed')}). ${Number.isFinite(event.usage?.seconds) ? 'Final voice duration received.' : 'Voice duration was not supplied.'}`);
   phase(run, 'stopped');
   const id = run.sessionId; release(run); void serverClose(id);
  } else if (event.type === 'session.usage.updated') {
   if (Number.isFinite(event.usage?.seconds) && event.usage.seconds >= 0) run.seconds = event.usage.seconds;
   reportUsage(run);
  } else if (event.type === 'error') {
   run.failureCode = closing ? 'LIVE_CLOSE_ERROR' : 'LIVE_EVENT_ERROR';
   failed(run, closing ? 'Voice did not acknowledge the close command.' : 'GPT-Live rejected a session command. Check model access and configuration, then start again.');
  } else if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') {
   if (!run.transcript.add(event)) return;
   if (event.type === 'session.input_transcript.delta') {
    window.WI_VOICE_GUIDE?.stop(); run.inputRevision++; clearBeats(run); cancelPending(run);
    // A fresh utterance may arrive in the short transcript-drain window, before
    // there is an HTTP request to abort. Do not start that outdated lookup.
    if (Number.isFinite(run.delegationOffset) && event.start_ms > run.delegationOffset) { if (run.delegationTimer != null) run.recoveryNeeded = true; clearTimeout(run.delegationTimer); run.delegationTimer = null; ++run.delegationOrder; }
    scheduleRecovery(run);
    phase(run, 'listening', { reason: 'input-transcript' });
   }
   else { window.WI_VOICE_GUIDE?.speak(event.delta); phase(run, 'speaking'); }
   notify('wi-voice-transcript', { text: event.delta, role: event.type === 'session.input_transcript.delta' ? 'user' : 'assistant', turnId: run.turnId || null, ...(event.type === 'session.input_transcript.delta' ? { utteranceText: run.transcript.text('user', run.answeredOffset).slice(-2000), inputRevision: run.inputRevision } : {}) });
   $('#wl-user-caption').textContent = run.transcript.text('user').slice(-10000) || 'Waiting for speech…';
   $('#wl-ai-caption').textContent = run.transcript.text('assistant').slice(-10000) || 'Waiting for AI speech…';
  } else if (event.type === 'session.commentary.appended') { acceptBeat(run, event); }
  else if (event.type === 'session.delegation.created') { void delegated(run, event); }
 }
 async function waitICE(pc, signal) {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise((resolve, reject) => {
   const done = error => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
   const check = () => { if (pc.iceGatheringState === 'complete') done(); };
   const abort = () => done(Error('Connection setup was cancelled.'));
   const timer = setTimeout(() => done(Error('ICE gathering timed out. Check your network.')),10000);
   pc.addEventListener('icegatheringstatechange',check); signal.addEventListener('abort',abort,{once:true}); if (signal.aborted) abort(); else check();
  });
 }
 async function start() {
  if (active || !available || closing) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) { state('Continuous voice needs a WebRTC browser with microphone access on localhost or HTTPS.'); return; }
  window.dispatchEvent(new Event('wi-stop-media')); api()?.cancel?.();
  const run = { serial: ++serial, stage:'workspace.authentication', sessionRequested:false, pc: null, stream: null, channel: null, ready: false, muted: false, sessionId: null, pending: null, startControl: new AbortController(), seconds: null, transcript: timeline(), inputRevision: 0, delegationOrder: 0, answeredOffset: -1, seenDelegations: new Set(), turnId: null, beats: null, recoveryNeeded: false, recoveryAttempts: 0, recoveryTimer: null, delegationTimer: null };
  lastClientFailure = null;
  active = run; controls(); state('Checking workspace sign-in…'); phase(run, 'connecting'); $('#wl-signin').hidden = true; $('#wl-result').textContent = 'Waiting for your question.';
  $('#wl-user-caption').textContent = 'Your speech will appear here.'; $('#wl-ai-caption').textContent = 'Spoken captions will appear here.'; reportUsage(run);
  run.startTimer = setTimeout(() => failed(run, 'Conversation startup timed out.'),45000);
  try {
   const authenticated = await fetch('/api/status', { signal: run.startControl.signal, cache: 'no-store' });
   if (!authenticated.ok) { run.failureCode = `HTTP_${authenticated.status}`; throw Error(authenticated.status === 401 ? 'Your workspace sign-in expired. Reload this page and sign in again to continue voice.' : 'Could not verify workspace access. Refresh this page and try again.'); }
   if (!current(run) || closing) return;
   run.stage = 'browser.microphone'; state('Requesting microphone access…');
   const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
   if (!current(run) || closing) { stream.getTracks().forEach(track => track.stop()); return; }
   run.stream = stream; micStatus(run); stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (current(run) && !closing) failed(run,'Microphone disconnected.'); },{once:true}));
   run.stage = 'browser.webrtc_offer';
   const pc = new RTCPeerConnection(); run.pc = pc;
   pc.onconnectionstatechange = () => {
    if (!current(run)) return;
    clearTimeout(run.disconnectTimer);
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') failed(run,'Voice connection ended unexpectedly.');
    else if (pc.connectionState === 'disconnected') { state('Voice connection interrupted. Reconnecting…'); run.disconnectTimer = setTimeout(() => failed(run,'Voice network connection was lost.'),8000); }
    else if (pc.connectionState === 'connected' && run.ready && !closing) state('Connected. You can speak and interrupt naturally.');
   };
   pc.ontrack = async event => {
    if (!current(run)) { event.track.stop(); return; }
    const audio = $('#wl-audio'); audio.srcObject = event.streams[0] || new MediaStream([event.track]);
    try { await audio.play(); if (current(run)) $('#wl-playback').textContent = 'AI voice playback active'; }
    catch { if (current(run)) $('#wl-playback').textContent = 'Press Play in the audio controls to hear the AI voice'; }
   };
   stream.getTracks().forEach(track => pc.addTrack(track,stream));
   const channel = pc.createDataChannel('oai-events'); run.channel = channel;
   channel.onmessage = e => { if (typeof e.data !== 'string' || e.data.length > 128000) return; try { eventReceived(run,JSON.parse(e.data)); } catch { failed(run,'Invalid voice event received.'); } };
   channel.onerror = () => failed(run,'The voice event channel failed.'); channel.onclose = () => failed(run,'The voice event channel closed before finalization.');
   state('Connecting microphone and AI voice…');
   const offer = await pc.createOffer(); if (!current(run)) return; await pc.setLocalDescription(offer); await waitICE(pc,run.startControl.signal);
   if (!current(run) || closing) return;
   run.stage = 'server.live_session'; run.sessionRequested = true;
   const res = await fetch('/api/live/session',{method:'POST',headers:{'Content-Type':'application/json'},signal:run.startControl.signal,body:JSON.stringify({sdp:pc.localDescription.sdp,scope:scope(),context:context(),history:history()})});
   if (!res.ok) {
    let detail; try { detail = await res.json(); } catch {}
    run.failureCode = typeof detail?.code === 'string' && /^[A-Z_]{1,60}$/.test(detail.code) ? detail.code : `HTTP_${res.status}`;
    run.diagnosticId = typeof detail?.diagnosticId === 'string' && /^[a-f0-9-]{36}$/.test(detail.diagnosticId) ? detail.diagnosticId : null;
    throw Error((res.status === 401 ? 'Your workspace sign-in expired. Reload this page and sign in again to continue voice.' : detail?.error || `Voice startup failed (${res.status}).`) + ` [${run.failureCode}]`);
   }
   const data = await res.json();
   if (!validId(data.session?.id) || data.transport?.type !== 'webrtc' || typeof data.transport.sdp !== 'string') throw Error('Invalid voice session response.');
   run.sessionId = data.session.id;
   if (!current(run) || closing) { void serverClose(run.sessionId); return; }
   run.stage = 'browser.webrtc_answer';
   await pc.setRemoteDescription({type:'answer',sdp:data.transport.sdp});
   run.stage = 'voice.awaiting_start';
   run.maxTimer = setTimeout(() => { if (current(run)) stop('The 15-minute session limit was reached. Finishing conversation…'); }, Math.min(data.maxSessionMs || 900000,900000) - 15000);
   // HTTP already started this session. session.start must not be sent here.
  } catch (error) { if (current(run)) failed(run,error.name === 'NotAllowedError' ? 'Microphone permission was denied.' : error.message || 'Could not start continuous voice.'); }
 }
 $('#wl-start').addEventListener('click',start); $('#wl-stop').addEventListener('click',() => stop());
 $('#wl-check').addEventListener('click',checkConnection); $('#wl-report').addEventListener('click',downloadReport);
 $('#wl-close').addEventListener('click',closePanel);
 $('#wl-signin').addEventListener('click',() => window.location.reload());
 host.addEventListener('keydown',event => { if (event.key === 'Escape') { event.preventDefault?.(); closePanel(); } });
 $('#wl-mute').addEventListener('click',() => {
  const run = active; if (!run?.ready || closing) return;
  run.muted = !run.muted; run.stream?.getAudioTracks().forEach(track => { track.enabled = !run.muted; }); micStatus(run);
  // Local track state is authoritative for this UI. No claim of server mute acknowledgment.
  state(run.muted ? 'Microphone muted locally. Voice session remains active and billed.' : 'Microphone active. You can speak.');
  phase(run, run.muted ? 'muted' : 'listening');
 });
 $('#wl-audio').addEventListener('playing',() => { if (active) $('#wl-playback').textContent = 'AI voice playback active'; });
 $('#wl-audio').addEventListener('pause',() => { if (active) $('#wl-playback').textContent = 'AI voice playback paused'; });
 window.addEventListener('wi-stop-media',() => stop('Switching conversation mode. Finishing continuous voice…'));
 window.addEventListener('wi-source-updated',() => stop('Source data refreshed. Finishing this conversation; start again using the new evidence.'));
 window.addEventListener('wi-context-changed',syncContext);
 document.getElementById('wi-app')?.addEventListener?.('change',syncContext);
 window.addEventListener('offline',() => { if (active) failed(active,'Browser network connection is offline.'); });
 window.addEventListener('pagehide',() => { const run = active; if (!run) return; try { command(run,'session.close'); } catch {} void serverClose(run.sessionId,true); phase(run, 'stopped'); release(run); });
 window.WI_LIVE = Object.freeze({ open: openPanel, close: closePanel, start, stop, syncContext, isActive: () => !!active });
 fetch('/api/status').then(res => { if (!res.ok) throw Object.assign(Error(),{status:res.status}); return res.json(); }).then(data => {
  available = data.live?.available === true || data.continuousVoice === true;
  $('#wl-version').textContent = typeof data.version === 'string' ? '· App ' + data.version : '';
  state(available ? 'Ready. Start a conversation to enable your microphone.' : 'Continuous voice is unavailable. Configure the server API key and GPT-Live access; typed questions remain available.'); controls();
 }).catch(error => { available = false; $('#wl-signin').hidden = error.status !== 401; state(error.status === 401 ? 'Your workspace sign-in expired. Reload this page and sign in again to continue voice.' : 'Could not check continuous voice availability.'); controls(); });
})();
