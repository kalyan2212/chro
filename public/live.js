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
 function speechRequest(entries, after = -1, through = Infinity) {
  const selected = entries.filter(e => e.role === 'user' && e.end > after && e.start <= through).sort((a,b) => a.start-b.start || a.end-b.end);
  const text = selected.map(e => e.text).join('').trim();
  const end = selected.reduce((value,e) => Math.max(value,e.end),Number.isFinite(through)?through:after);
  if (text.length <= 2000) return { question:text, history:[], compacted:false, through:end };
  // Keep whole spoken sentences/utterances, never an arbitrary trailing word
  // slice. Pauses are only a boundary for bounded context, not an end-of-turn claim.
  const groups=[]; let previous=null;
  for (const entry of selected) {
   if (!previous || entry.start-previous.end >= 1200) groups.push(entry.text);
   else groups[groups.length-1] += entry.text;
   previous=entry;
  }
  const segmenter = new Intl.Segmenter('en',{granularity:'sentence'});
  const groupedUnits=groups.map(group => [...segmenter.segment(group)].map(part => part.segment.trim()).filter(Boolean)), units=groupedUnits.flat();
  const recent=[]; let length=0,index=units.length-1;
  const latestGroupStart=units.length-(groupedUnits.at(-1)?.length||0);
  for (;index>=latestGroupStart;index--) { if (length+units[index].length+(recent.length?1:0)>2000) break; recent.unshift(units[index]);length+=units[index].length+1; }
  if (!recent.length) return { question:'', history:[], compacted:true, tooLong:true, through:end };
  const earlier=units.slice(0,index+1), chunks=[]; let chunk='';
  const prefix='Earlier unanswered speech, for context: ';
  for (let i=earlier.length-1;i>=0;i--) {
   if (earlier[i].length>2000-prefix.length) continue;
   const next=earlier[i]+(chunk?' '+chunk:'');
   if (next.length>2000-prefix.length) { chunks.unshift(chunk);chunk='';if(chunks.length===2)break; }
   chunk=earlier[i]+(chunk?' '+chunk:'');
  }
  if (chunk&&chunks.length<2) chunks.unshift(chunk);
  const anchor=earlier[0];
  if(anchor&&anchor.length<=2000-prefix.length&&!chunks.some(value=>value.includes(anchor)))chunks.unshift(anchor);
  return { question:recent.join(' '), history:chunks.map(value=>({role:'user',text:prefix+value})), compacted:true, through:end };
 }
 function discoveryRequest(text) {
  const value=String(text||'').toLowerCase();
  if (/\b(?:do not|don't|stop|never)\s+(?:show|list|display|browse|search)\b/.test(value)) return false;
  const ask=/\b(?:show|list|display|browse|tell|explore|find|what|which)\b/.test(value);
  const breadth=/\b(?:categor(?:y|ies)|catalog(?:ue)?|everything|available|all\s+(?:the\s+)?(?:metrics|data|options|costs))\b/.test(value)||/\bwhat\b[\s\S]{0,100}\bhave\b/.test(value);
  const business=/\b(?:workforce|costs?|categories|category|data|dashboard|metrics?|evidence|headcount|hiring|retention|onboarding|attrition|compensation|pay|skills?|capability|learning|service|cases|relations|experience|surveys?|recognition|diversity|representation|leadership|continuity|delivery|automation|people|employees?|organization|organisation|capacity|mobility|talent|economics|overtime|contractors?)\b/.test(value);
  return ask&&breadth&&(business||/\b(?:show|list|display|browse)\b[\s\S]{0,80}\beverything\b|\bwhat\s+(?:else\s+)?(?:do|can)\s+you\s+(?:have|show)\b/.test(value));
 }
 function sourceGuideRequest(text, hasGuide = false) {
  const value=String(text||'').trim().toLowerCase().replace(/[.!?]+$/,'').replace(/\s+/g,' ');
  if(!value||/^(?:okay|ok|sure|thanks|thank you|hello|hi|stop|uh|um|hmm)$/.test(value))return false;
  if(hasGuide)return true;
  if(/^(?:yes|no)$/.test(value))return false;
  const requested=value.replace(/^(?:can|could|would|will) you /,'').replace(/^please /,'');
  return /^(?:update|edit|change|adjust|correct|revise|modify)\b/.test(requested)&&/\b(?:costs?|salary|salaries|compensation|payroll|overtime|contractors?|headcount|source (?:data|records?))\b/.test(requested);
 }
 function chartRequest(text) {
  // Only a complete presentation command can bypass analytical delegation.
  // Named metrics, comparisons, explanations and compound requests stay there.
  let value=String(text||'').trim().toLowerCase().replace(/[.!?]+$/,'').replace(/\s+/g,' ');
  if(value.length>180)return null;
  value=value.replace(/^(?:okay[, ]+|ok[, ]+|now[, ]+)/,'').replace(/^(?:can|could|would|will) you /,'').replace(/^please /,'').replace(/(?:,? please| now| instead)$/,'');
  const target='(bar|line|pie)(?: chart| graph| view)?',article='(?:(?:a|an|the) )?',subject='(?:(?:(?:(?:the )?(?:current|selected|existing)|the|this) )?(?:(?:bar|line|pie)(?: chart| graph)?|chart|graph|view)|it|this)';
  for(const pattern of [
   `^(?:change|switch|convert|turn) (?:${subject} )?(?:to|into) ${article}${target}$`,
   `^make ${subject} (?:(?:into|as) )?${article}${target}$`,
   `^(?:show|display|render|draw) (?:me )?(?:${subject} (?:as|in) )?${article}${target}$`,
   `^(?:i want|i would like|i'd like) (?:${subject} (?:as|in|to be) )?${article}${target}$`
  ]){const match=value.match(new RegExp(pattern));if(match)return {type:match[1]};}
  return null;
 }
 function sourceEditCommand(text) {
  const value=String(text||'').trim().toLowerCase().replace(/[.!?]+$/,'').replace(/\s+/g,' ').replace(/^(?:can|could|would|will) you /,'').replace(/^please /,'').replace(/,? please$/,'');
  if(/^(?:apply (?:(?:the )?(?:these|those)|the proposed|the source) (?:changes|update)|confirm (?:this |the |the source )?update|save (?:these|the proposed) changes)$/.test(value))return 'apply';
  if(/^(?:undo|revert) (?:that|this|the last|the) source (?:change|update|edit)$/.test(value))return 'undo';
  return null;
 }
 function sourceEditFragment(text) {
  const value=String(text||'').trim().toLowerCase().replace(/[.!?]+$/,'').replace(/^please /,'');
  return /^(?:apply|confirm|save)$/.test(value)?'apply':/^(?:undo|revert)$/.test(value)?'undo':null;
 }
 function matches(result, sessionId, delegationId, recovery = false) {
  if ((result?.recovery === true) !== recovery) return false;
  const valid = event => event?.type === 'session.commentary.append' && event.delegation_id === (recovery ? null : delegationId) && typeof event.content === 'string' && event.content.length > 0 && event.content.length < 2000 && validId(event.event_id);
  if (result?.sessionId !== sessionId || result?.delegationId !== delegationId || !valid(result?.event) || !result.response || typeof result.response.answer !== 'string') return false;
  if (result.events == null) return true; // A previously deployed server may return only event.
  return Array.isArray(result.events) && result.events.length > 0 && result.events.length <= 8 && result.events.every(event => valid(event) && bytes(event.content) <= 450) && new Set(result.events.map(event => event.event_id)).size === result.events.length && result.events[0].event_id === result.event.event_id && result.events[0].content === result.event.content;
 }
 // Pure helpers also used by the protocol tests. Studio explicitly requests its
 // one automatic welcome; the classic workspace remains opt-in.
 window.WI_LIVE_PROTOCOL = Object.freeze({ timeline, matches, snapshot, speechRequest, discoveryRequest, sourceGuideRequest, chartRequest, chartCommand:text=>chartRequest(text)?.type||null, sourceEditCommand, sourceEditFragment });
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
  <details class="wl-transcripts"><summary>Your voice input — approximate, may contain errors</summary><div class="wl-caption-grid wl-input-only"><div><h3>You</h3><p id="wl-user-caption">Your speech will appear here.</p></div></div></details>
  <p id="wl-result" class="wl-result" aria-live="polite">Ask about a metric or a scenario. Validated answers also update the visual briefing.</p>
 </section>`;
 const $ = selector => host.querySelector(selector);
 let available = false, availabilityChecked = false, autoRequested = false, autoConsumed = false;
 let serial = 0, active = null, closing = false, panelOpen = false, checking = false, lastClientFailure = null, lastState = { phase: 'idle', turnId: null };
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
 const viewContext = () => window.WI_STUDIO?.getViewContext?.() || null;
 const reportContext = () => window.WI_STUDIO?.getReportContext?.() || null;
 const presentationPreferences = () => window.WI_STUDIO?.getPresentationPreferences?.() || null;
 const sourceEditContext = () => window.WI_STUDIO?.getSourceEditContext?.() || null;
 const pendingEdit = () => window.WI_STUDIO?.getPendingEdit?.() || null;
 const lastSourceEdit = () => window.WI_STUDIO?.getLastSourceEdit?.() || null;
 const selection = () => ({ scope:scope(),metric:context().metricId||null,scenario:context().caseId||null,audience:audience(),viewContext:viewContext(),reportContext:reportContext(),presentationPreferences:presentationPreferences(),sourceEditContext:sourceEditContext() });
 const history = () => (api()?.getHistory?.() || []).slice(-24).map(x => ({ role: x.role, text: String(x.text || '').slice(0,2000) }));
 const current = run => active === run && run.serial === serial;
 function notify(type, detail) { window.dispatchEvent(new CustomEvent(type, { detail: snapshot(detail) })); }
 function phase(run, value, detail = {}) {
  if (run && run.phase === value && !Object.keys(detail).length) return;
  if (run) run.phase = value;
  lastState = { phase: value, turnId: run?.turnId || null, ...detail };
  notify('wi-voice-state', lastState);
 }
 function clearBeats(run) { clearTimeout(run.beatTimer); run.beatTimer = null; run.beats = null; }
 function clearRecovery(run) { clearTimeout(run.recoveryTimer); run.recoveryTimer = null; run.recoveryNeeded = false; }
 function clearChart(run) { clearTimeout(run.chartTimer); run.chartTimer = null; }
 function chartFeedback(result) {
  const fallback=result?.ok?'The selected view has changed. The displayed evidence values and scope are unchanged.':'I could not change that view. Select a chart or report and use one of its available views.';
  const message=typeof result?.message==='string'&&result.message.trim()?result.message.trim():fallback;
  if(bytes(message)<=450)return message;
  let content='';for(const item of new Intl.Segmenter('en',{granularity:'sentence'}).segment(message)){const next=(content+' '+item.segment.trim()).trim();if(bytes(next)>450)break;content=next;}return content||fallback;
 }
 function applyChart(run,action,{through,providerId=null,isCurrent=()=>true,announce=true,question}={}) {
  if(!current(run)||closing||!isCurrent())return null;
  let result;
  try { result=window.WI_STUDIO?.applyViewAction?.(action,{origin:'voice',isCurrent:()=>current(run)&&!closing&&isCurrent()}); }
  catch { result={ok:false,message:'The view could not be changed. The current evidence remains on screen; try its display controls.'}; }
  // The controller is synchronous: confirmation follows an actual DOM update.
  if(!result||typeof result.ok!=='boolean')result={ok:false,message:'Select a chart or report first, then ask for one of its available views.'};
  if(!current(run)||closing||!isCurrent())return null;
  if(Number.isFinite(through))run.answeredOffset=through;
  run.recoveryAttempts=0;run.recoveryRetryAfter=null;run.contextKey=JSON.stringify(selection());
  const message=chartFeedback(result);$('#wl-result').textContent=message;
  const kind=action.type==='change_report_view'?'report':'chart';phase(run,'listening',{reason:kind+(result.ok?'-changed':'-unavailable'),message});
  if(announce)command(run,'session.commentary.append',{delegation_id:providerId,content:message});
  if(question)window.WI_STUDIO?.recordAction?.(question,message);
  notify('wi-voice-view-action',{action,result,turnId:run.turnId});
  return result;
 }
 function applyViewActions(run,actions,options={}) {
  if(!Array.isArray(actions)||!actions.length||actions.length>4||actions.some(action=>!['change_chart','change_report_view'].includes(action?.type)))throw Error('The requested view change was not valid. The current evidence remains on screen.');
  const results=[];for(const action of actions){const result=applyChart(run,action,{...options,announce:false});if(!result)return null;results.push(result);}return results;
 }
 const viewEvents=(results,providerId)=>results.map(result=>({type:'session.commentary.append',event_id:`view_${crypto.randomUUID()}`,delegation_id:providerId,content:chartFeedback(result)}));
 function displaySource(run,response,isCurrent) {
  if(!current(run)||closing||!isCurrent())return null;
  const results=[];
  if(response.sourceEditGuide&&!response.sourceEditProposal){
   const guide=response.sourceEditGuide,reviewed=window.WI_STUDIO?.showSourceEditGuide?.(guide,{origin:'voice',isCurrent});
   if(!reviewed?.ok||typeof reviewed.message!=='string'||!reviewed.message.trim()||bytes(reviewed.message)>450||!guide.context||!Object.entries(guide.context).every(([key,value])=>sourceEditContext()?.[key]===value))throw Error('The source edit step could not be displayed. No source change has been confirmed.');
   results.push({ok:true,message:reviewed.message});
  }
  else if(response.sourceData){if(!window.WI_STUDIO?.renderSourceRows?.(response.sourceData,{origin:'voice',isCurrent}))throw Error('The source records could not be displayed.');results.push({ok:true,message:'Current source records are on screen. Displaying them has not changed the stored source.'});}
  if(response.sourceEditProposal){
   const proposal=response.sourceEditProposal,reviewed=window.WI_STUDIO?.showSourceEditProposal?.(proposal,{origin:'voice',isCurrent});
   if(!reviewed?.ok||pendingEdit()?.id!==proposal.id)throw Error('The source proposal could not be displayed for review. No source change has been confirmed.');
   results.push({ok:true,message:'The proposed source update is ready for review. It has not been applied. Check the before and after values, then say "apply these changes" to save this exact proposal.'});
  }
  if(results.length){const message=results.at(-1).message;$('#wl-result').textContent=message;phase(run,'listening',{reason:response.sourceEditProposal?'source-edit-proposed':response.sourceEditGuide?'source-edit-guided':'source-records-displayed',message});}
  return results;
 }
 function localChart(run,assembled,providerId=null) {
  const request=chartRequest(assembled.question);if(!request)return false;
  const selected=viewContext();
  run.pending?.abort();run.pending=null;clearChart(run);clearRecovery(run);clearBeats(run);clearTimeout(run.delegationTimer);run.delegationTimer=null;
  run.turnId=providerId||`chart_${crypto.randomUUID()}`;
  applyChart(run,{type:'change_chart',chartId:selected?.chartId||null,chartType:request.type,sourceVersion:selected?.sourceVersion||null},{through:assembled.through,providerId,question:assembled.question});
  return true;
 }
 function scheduleChart(run) {
  clearChart(run);if(!current(run)||closing||!run.ready)return;
  const assembled=speechRequest(run.transcript.entries(),run.answeredOffset),fragment=sourceEditFragment(assembled.question),source=sourceEditCommand(assembled.question)||(fragment&&(fragment==='apply'?pendingEdit():lastSourceEdit())?.id?fragment:null);if(!chartRequest(assembled.question)&&!source)return;
  const revision=run.inputRevision,order=run.delegationOrder,key=JSON.stringify(selection()),image=attachedImage()?.dataUrl,editKey=source?JSON.stringify(source==='apply'?pendingEdit():lastSourceEdit()):null;
  run.chartTimer=setTimeout(()=>{run.chartTimer=null;if(!current(run)||closing||revision!==run.inputRevision||order!==run.delegationOrder||key!==JSON.stringify(selection())||image!==attachedImage()?.dataUrl||(source&&editKey!==JSON.stringify(source==='apply'?pendingEdit():lastSourceEdit())))return;if(!incompleteSourceEdit(run,assembled)&&!localSourceEdit(run,assembled))localChart(run,assembled);},fragment?1800:650);
 }
 function incompleteSourceEdit(run,assembled,providerId=null) {
  const type=sourceEditFragment(assembled.question),edit=type==='apply'?pendingEdit():lastSourceEdit();if(!type||!edit?.id)return false;
  run.pending?.abort();run.pending=null;clearTimeout(run.sourceTimer);clearChart(run);clearRecovery(run);clearBeats(run);clearTimeout(run.delegationTimer);run.delegationTimer=null;
  run.answeredOffset=assembled.through;run.turnId=providerId||`source_confirmation_${crypto.randomUUID()}`;
  const message=type==='apply'?'I heard only a short confirmation. To save this exact reviewed proposal, say "apply these changes" or use Apply on screen. No source change has been confirmed.':'I heard only a short undo request. Say "undo that source change" to undo the identified last source edit. No undo has been confirmed.';
  $('#wl-result').textContent=message;phase(run,'listening',{reason:'source-confirmation-incomplete',message});command(run,'session.commentary.append',{delegation_id:providerId,content:message});return true;
 }
 function localSourceEdit(run,assembled,providerId=null) {
  const commandType=sourceEditCommand(assembled.question);if(!commandType)return false;
  const edit=commandType==='apply'?pendingEdit():lastSourceEdit(),method=commandType==='apply'?'applyPendingEdit':'undoSourceEdit';
  run.pending?.abort();run.pending=null;clearTimeout(run.sourceTimer);clearChart(run);clearRecovery(run);clearBeats(run);clearTimeout(run.delegationTimer);run.delegationTimer=null;
  // Consume the confirmation when accepted, so a late duplicate delegation
  // cannot submit the same write twice while its first response is pending.
  run.answeredOffset=assembled.through;run.turnId=providerId||`source_${crypto.randomUUID()}`;
  if(!edit?.id||!edit.sourceVersion||typeof window.WI_STUDIO?.[method]!=='function'){
   const message=commandType==='apply'?'There is no source update awaiting confirmation. Ask for a specific source change first so you can review its before and after values.':'There is no identified source edit available to undo. Review the current source revision before requesting another change.';
   $('#wl-result').textContent=message;phase(run,'listening',{reason:'source-edit-unavailable',message});command(run,'session.commentary.append',{delegation_id:providerId,content:message});return true;
  }
  const ctrl=new AbortController(),revision=run.inputRevision,order=++run.delegationOrder,operationId=`source_${crypto.randomUUID()}`;
  run.pending=ctrl;run.sourceOperation={operationId,ctrl,refreshed:false};
  const isCurrent=()=>current(run)&&!closing&&!ctrl.signal.aborted&&revision===run.inputRevision&&order===run.delegationOrder;
  const message=commandType==='apply'?'Applying the reviewed source update…':'Undoing the identified source update…';$('#wl-result').textContent=message;phase(run,'thinking',{reason:'source-edit-pending',message});
  command(run,'session.thinking.append',{delegation_id:providerId,content:'The user confirmed the identified source operation. The application is waiting for persistence. Do not say it is saved or undone until the application confirms the result.'});
  const timer=setTimeout(()=>{ctrl.abort();if(!current(run)||closing||revision!==run.inputRevision||order!==run.delegationOrder)return;const feedback='The source operation timed out before confirmation. Review its status before retrying; it may already have reached the server.';$('#wl-result').textContent=feedback;phase(run,'listening',{reason:'source-edit-unconfirmed',message:feedback});command(run,'session.commentary.append',{delegation_id:providerId,content:feedback});},60000);run.sourceTimer=timer;
  void (async()=>{
   try {
    const result=await window.WI_STUDIO[method]({origin:'voice',operationId,...(commandType==='apply'?{proposalId:edit.id}:{editId:edit.id}),expectedSourceVersion:edit.sourceVersion,signal:ctrl.signal,isCurrent});
    if(!isCurrent())return;
    const feedback=result?.ok===true?chartFeedback(result):chartFeedback({ok:false,message:result?.message||'The source operation was not confirmed. Review the source update status before trying again.'});
    if(result?.ok===true){run.contextKey=JSON.stringify(selection());command(run,'session.instructions.append',{delegation_id:null,content:'The application confirmed a persisted source revision change. Earlier-source observations are superseded. Use the current dashboard selection and delegate every new business fact to the backend; do not reuse old figures as current data.'});}
    const targets=edit.changes?.filter(change=>!change.derived).slice(0,6).map(change=>[change.month,change.function,change.region,change.path].join(' / ')).join('; ');
    window.WI_STUDIO?.recordAction?.(assembled.question,feedback+(targets?' Source targets: '+targets+'.':''));
    $('#wl-result').textContent=feedback;phase(run,'listening',{reason:result?.ok?'source-edit-complete':'source-edit-unconfirmed',message:feedback});command(run,'session.commentary.append',{delegation_id:providerId,content:feedback});
   }catch(error){
    if(!current(run)||closing||revision!==run.inputRevision||order!==run.delegationOrder)return;
    const feedback='The source operation could not be confirmed. Check its status before trying again; the request may already have reached the server.';
    $('#wl-result').textContent=feedback;phase(run,'listening',{reason:'source-edit-unconfirmed',message:feedback});command(run,'session.commentary.append',{delegation_id:providerId,content:feedback});
   }finally{clearTimeout(timer);if(run.sourceTimer===timer)run.sourceTimer=null;if(run.pending===ctrl)run.pending=null;if(run.sourceOperation?.operationId===operationId)run.sourceOperation=null;}
  })();
  return true;
 }
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
  clearChart(run);
  clearTimeout(run.startTimer); clearTimeout(run.closeTimer); clearTimeout(run.maxTimer); clearTimeout(run.disconnectTimer); clearTimeout(run.delegationTimer); clearTimeout(run.playbackTimer); clearTimeout(run.welcomeTimer); clearTimeout(run.sourceTimer);
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
  autoRequested = false; autoConsumed = true;
  window.WI_VOICE_GUIDE?.stop();
  const run = active; if (!run || closing) return;
  clearBeats(run); clearChart(run); phase(run, 'stopped');
  closing = true; run.pending?.abort(); clearTimeout(run.sourceTimer); clearTimeout(run.delegationTimer); run.delegationTimer = null; clearRecovery(run);
  $('#wl-audio').pause();
  run.stream?.getTracks().forEach(track => { track.enabled = false; }); run.muted = true; micStatus(run); controls();
  if (run.ready && run.channel?.readyState === 'open') {
   state(reason); command(run, 'session.close');
   run.closeTimer = setTimeout(() => failed(run, 'No session.closed event arrived before the close timeout.'), 15000);
  } else { failed(run, 'Connection setup was cancelled.'); }
 }
 function cancelPending(run) {
  if (!run.pending) return;
  run.pending.abort(); run.pending = null; clearTimeout(run.sourceTimer);
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
    run.recoveryRetryAfter = run.transcript.entries().filter(entry=>entry.role==='user').reduce((end,entry)=>Math.max(end,entry.end),run.answeredOffset);
    $('#wl-result').textContent = 'Voice could not settle this request after two recovery attempts. Please repeat the complete question or type it below.';
    phase(run, 'listening', { reason: 'recovery-exhausted', message: $('#wl-result').textContent });
    command(run, 'session.instructions.append', { delegation_id: null, content: 'The application stopped automatic recovery after repeated changes. No result is verified. Ask the caller to repeat the complete question or type it; do not keep saying that you are checking.' });
    return;
   }
   const through = run.transcript.entries().filter(entry => entry.role === 'user' && entry.end > run.answeredOffset).reduce((end, entry) => Math.max(end, entry.end), -1);
   if (through < 0) { run.recoveryNeeded = false; return; }
   run.recoveryAttempts++;
   void delegated(run, { offset_ms: through, delegation: { id: `recovery_${crypto.randomUUID()}`, target: 'client' } }, true);
  }, sourceEditContext()?1800:900);
 }
 function syncContext(event) {
  if (event?.type === 'wi-context-changed' || event?.force === true) {
   autoRequested = false; autoConsumed = true;
   if (active?.automatic && !active.ready) { stop('Automatic voice setup cancelled because the page changed.'); return; }
  }
  const run = active; if (!run?.ready || closing) return;
  const values = selection();
  const key = JSON.stringify(values);
  // An explicit application navigation/question event invalidates pending work
  // even when it keeps the same filters (for example Home or a typed follow-up).
  const forced = event?.type === 'wi-context-changed' || event?.force === true;
  if (key === run.contextKey && !forced) return;
  const changed = !!run.contextKey || forced; run.contextKey = key;
  if (changed) {
   run.pending?.abort(); run.pending = null; clearTimeout(run.sourceTimer); ++run.delegationOrder; clearTimeout(run.delegationTimer); run.delegationTimer = null; clearRecovery(run); clearChart(run); clearBeats(run); window.WI_VOICE_GUIDE?.stop();
   run.answeredOffset = run.transcript.entries().filter(entry => entry.role === 'user').reduce((end, entry) => Math.max(end, entry.end), run.answeredOffset);
   run.delegationOffset = null; run.recoveryAttempts = 0; run.recoveryRetryAfter = null; run.recoveryTurnId = null;
   command(run, 'session.instructions.append', { delegation_id: null, content: 'The user changed the question or dashboard selection. Stop the previous explanation and use the latest selection for the next question. Earlier pending results have been discarded.' });
   phase(run, 'listening', { reason: 'context-changed' });
  }
  const content = 'Current synthetic dashboard selection: ' + key + '. Use this to understand references; delegate all requested facts and calculations.';
  if (bytes(content) <= 450) command(run, 'session.thinking.append', { delegation_id: null, content });
  const guide=sourceEditContext();if(guide){const cue='A source edit guide is open. Delegate short field choices, amounts, allocation choices and reasons using its current application context. Ask only the next question returned by the displayed step. A guide is not a saved source change.';command(run,'session.thinking.append',{delegation_id:null,content:cue});}
  const view=viewContext();if(view){const cue='Selected chart metadata: '+JSON.stringify({chartId:view.chartId,currentType:view.currentType,availableTypes:view.availableTypes})+'. Delegate chart changes; wait for renderer feedback.';if(bytes(cue)<=450)command(run,'session.thinking.append',{delegation_id:null,content:cue});}
 }
 async function delegated(run, event, recovery = false) {
  const delegationId = event.delegation?.id;
  if (!current(run) || closing || !validId(delegationId) || event.delegation?.target !== 'client' || run.seenDelegations.has(delegationId)) return;
  if (!Number.isFinite(event.offset_ms) || event.offset_ms < 0) return;
  if (event.offset_ms <= run.answeredOffset) return;
  if(run.sourceOperation&&!speechRequest(run.transcript.entries(),run.answeredOffset,event.offset_ms).question)return;
  run.seenDelegations.add(delegationId); run.pending?.abort(); clearTimeout(run.delegationTimer); run.delegationTimer = null; clearRecovery(run); clearChart(run); clearBeats(run); run.delegationOffset = event.offset_ms;
  if (!recovery) { run.recoveryAttempts = 0; run.recoveryRetryAfter = null; run.recoveryTurnId = null; }
  run.turnId = delegationId; phase(run, 'thinking');
  const order = ++run.delegationOrder;
  // Metadata carries no utterance. A short drain lets already-in-flight transcript
  // fragments arrive; it is not a claim that a transcript turn is complete.
  const execute = async () => {
   run.delegationTimer = null;
   if (!current(run) || closing || order !== run.delegationOrder) return;
    const assembled = speechRequest(run.transcript.entries(),run.answeredOffset,event.offset_ms), question = assembled.question;
    // A transcript delta can start before the delegation offset and end after
    // it. Its whole text belongs to this question; consume that same span when
    // the result succeeds so the final word cannot leak into the next turn.
    const questionThrough = assembled.through;
   if (!question && !assembled.tooLong && run.answeredOffset >= 0) { phase(run, 'listening'); return; }
   const providerId = recovery ? null : delegationId;
   if(question&&incompleteSourceEdit(run,assembled,providerId))return;
   if(question&&localSourceEdit(run,assembled,providerId))return;
   if(question&&localChart(run,assembled,providerId))return;
   if (!question || assembled.tooLong) {
    if (assembled.tooLong) run.answeredOffset = questionThrough;
    const message=assembled.tooLong?'That last spoken request was too long to preserve safely. Please repeat your latest request briefly; a business topic is enough, and I can discover the available evidence.':'I could not assemble your speech yet. Please repeat your request; you can name a business topic and I can discover the available evidence.';
    command(run, 'session.commentary.append', { delegation_id: providerId, content: message });
    $('#wl-result').textContent = message; phase(run,'listening',{reason:'transcript-incomplete',message}); return;
   }
   const revision = run.inputRevision, ctrl = new AbortController(); run.pending = ctrl;
   const scopeAtStart = JSON.stringify(scope()), contextAtStart = JSON.stringify(context()), imageAtStart=attachedImage(), audienceAtStart=audience(),viewAtStart=viewContext(),viewKey=JSON.stringify(viewAtStart),reportAtStart=reportContext(),reportKey=JSON.stringify(reportAtStart),preferencesAtStart=presentationPreferences(),preferencesKey=JSON.stringify(preferencesAtStart),guideAtStart=sourceEditContext(),guideKey=JSON.stringify(guideAtStart);
   $('#wl-result').textContent = 'Investigating your question across the available evidence…';
   phase(run,'thinking',{message:assembled.compacted?'Using your recent question with limited earlier conversation context. Investigating the available evidence.':'Investigating your question across the available evidence. You can interrupt to change direction.'});
   command(run,'session.thinking.append',{delegation_id:providerId,content:'The backend analyst is investigating the question. No result is verified yet. Briefly acknowledge the lookup if useful, then wait for the verified explanation; do not invent progress or findings.'});
   try {
    const res = await fetch('/api/live/delegate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(110000)]), body: JSON.stringify({ sessionId: run.sessionId, delegationId, ...(recovery ? { recovery: true, ...(run.recoveryTurnId?{recoveryTurnId:run.recoveryTurnId}:{}) } : {}), question, scope: scope(), context: context(), history: [...history(),...assembled.history].slice(-24), audience:audienceAtStart, viewContext:viewAtStart, reportContext:reportAtStart, presentationPreferences:preferencesAtStart, sourceEditContext:guideAtStart, sourceVersion:window.WI_DATA?.sourceVersion, ...(imageAtStart?{image:imageAtStart}:{}) }) });
    if (!res.ok) { let error; try { error = (await res.json()).error; } catch {} if (res.status === 401) { run.failureCode = 'HTTP_401'; failed(run, 'Your workspace sign-in expired. Reload this page and sign in again to continue voice.'); return; } throw Object.assign(Error(error || `Evidence lookup failed (${res.status}).`),{status:res.status}); }
    const value = await res.json();
    if (!current(run) || closing || ctrl.signal.aborted || revision !== run.inputRevision || order !== run.delegationOrder || scopeAtStart !== JSON.stringify(scope()) || contextAtStart !== JSON.stringify(context()) || imageAtStart?.dataUrl !== attachedImage()?.dataUrl || audienceAtStart!==audience() || viewKey!==JSON.stringify(viewContext()) || reportKey!==JSON.stringify(reportContext()) || preferencesKey!==JSON.stringify(presentationPreferences()) || guideKey!==JSON.stringify(sourceEditContext())) return;
    if (!matches(value, run.sessionId, delegationId, recovery)) throw Error('The evidence response did not match this conversation.');
    const result = snapshot(value);
    if(result.response.sourceOnly===true||((result.response.sourceData||result.response.sourceEditProposal||result.response.sourceEditGuide)&&!result.response.panels?.length)){
     const isCurrent=()=>current(run)&&!closing&&!ctrl.signal.aborted&&revision===run.inputRevision&&order===run.delegationOrder;
     const displayed=displaySource(run,result.response,isCurrent);if(!displayed)return;
     if(result.response.viewActions?.length){const applied=applyViewActions(run,result.response.viewActions,{isCurrent});if(!applied)return;displayed.push(...applied);}
     if(!displayed.length)throw Error('The source response contained no displayable result.');
     run.answeredOffset=questionThrough;run.recoveryAttempts=0;run.recoveryRetryAfter=null;run.contextKey=JSON.stringify(selection());
     window.WI_STUDIO?.recordAction?.(question,displayed.map(item=>item.message).join(' '));
     run.beats={events:viewEvents(displayed,providerId),cues:[],index:0,revision,scope:JSON.stringify(scope())};sendBeat(run);return;
    }
    if(result.response.presentationOnly===true){
     const applied=applyViewActions(run,result.response.viewActions,{through:questionThrough,isCurrent:()=>!ctrl.signal.aborted&&revision===run.inputRevision&&order===run.delegationOrder});if(!applied)return;
     window.WI_STUDIO?.recordAction?.(question,applied.map(item=>item.message).join(' '));
     run.beats={events:viewEvents(applied,providerId),cues:[],index:0,revision,scope:JSON.stringify(scope())};sendBeat(run);return;
    }
    if (!api()?.showResponse) throw Error('The visual briefing is unavailable.');
    const shown = await api().showResponse(result.response, { origin: 'voice', isCurrent: () => current(run) && !closing && !ctrl.signal.aborted && revision === run.inputRevision && order === run.delegationOrder && scopeAtStart === JSON.stringify(scope()) && imageAtStart?.dataUrl === attachedImage()?.dataUrl && audienceAtStart===audience() && viewKey===JSON.stringify(viewContext()) && reportKey===JSON.stringify(reportContext()) && preferencesKey===JSON.stringify(presentationPreferences()) && guideKey===JSON.stringify(sourceEditContext()) });
    if (!current(run) || closing || ctrl.signal.aborted || revision !== run.inputRevision || order !== run.delegationOrder) return;
    if (shown === false) throw Error('The data changed during this lookup. Ask again to use the latest evidence.');
     run.answeredOffset = questionThrough;
    run.recoveryAttempts = 0; run.recoveryRetryAfter = null;
    $('#wl-result').textContent = 'Validated visual briefing: ' + result.response.title + '. Exact figures and scenario assumptions appear in the evidence card.';
    window.WI_VOICE_GUIDE?.prepare(result.response);
    run.contextKey = JSON.stringify(selection());
    notify('wi-voice-answer', { response: result.response, turnId: delegationId, beatCount: result.events?.length || 1, narration:result.narration || null });
    let events=result.events||[result.event];
    if(result.response.sourceData||result.response.sourceEditProposal||result.response.sourceEditGuide){const displayed=displaySource(run,result.response,()=>!ctrl.signal.aborted&&revision===run.inputRevision&&order===run.delegationOrder);if(!displayed)return;events=[...events,...viewEvents(displayed,providerId)];}
    if(Array.isArray(result.response.viewActions)&&result.response.viewActions.length){
     const applied=applyViewActions(run,result.response.viewActions,{isCurrent:()=>!ctrl.signal.aborted&&revision===run.inputRevision&&order===run.delegationOrder});
     if(!applied)return;
     events=[...events,...viewEvents(applied,providerId)];
    }
    run.contextKey=JSON.stringify(selection());
    run.beats = { events, cues:result.narration?.beats, index: 0, revision, scope: JSON.stringify(scope()) };
    sendBeat(run);
   } catch (error) {
    if (!current(run) || closing || ctrl.signal.aborted || order !== run.delegationOrder) return;
    $('#wl-result').textContent = error.message || 'Evidence lookup failed. Please try again.';
    phase(run, 'listening', { reason: 'evidence-error', message: $('#wl-result').textContent });
    const feedback=[400,409].includes(error.status)?chartFeedback({ok:false,message:error.message}):'The evidence lookup did not complete. No new result is verified. Please ask again.';
    command(run, 'session.commentary.append', { delegation_id: providerId, content: feedback });
   } finally { if (run.pending === ctrl) run.pending = null; }
  };
  if (recovery) void execute(); else { const fragment=sourceEditFragment(speechRequest(run.transcript.entries(),run.answeredOffset,event.offset_ms).question),edit=fragment==='apply'?pendingEdit():lastSourceEdit();run.delegationTimer=setTimeout(execute,fragment&&edit?.id?1800:300); }
 }
 function eventReceived(run, event) {
  if (!current(run)) return;
  if (event.type === 'session.started') {
   if (run.sessionId && event.session?.id && event.session.id !== run.sessionId) { failed(run, 'Session identity mismatch.'); return; }
   if (run.ready || closing) return;
   run.ready = true; run.stage = 'voice.conversation'; clearTimeout(run.startTimer); controls(); state('Connected. You can speak and interrupt naturally.');
   scheduleWelcome(run); syncContext();
   if (run.playbackBlocked) playbackBlocked(run); else phase(run, 'listening');
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
    window.WI_VOICE_GUIDE?.stop(); run.inputRevision++; clearBeats(run); clearChart(run); cancelPending(run);
    // A fresh utterance may arrive in the short transcript-drain window, before
    // there is an HTTP request to abort. Do not start that outdated lookup.
    if (Number.isFinite(run.delegationOffset) && event.start_ms > run.delegationOffset) { if (run.delegationTimer != null) run.recoveryNeeded = true; clearTimeout(run.delegationTimer); run.delegationTimer = null; ++run.delegationOrder; }
    const needsBackend=question=>discoveryRequest(question)||sourceGuideRequest(question,!!sourceEditContext());
    const retryQuestion=Number.isFinite(run.recoveryRetryAfter)?speechRequest(run.transcript.entries(),run.recoveryRetryAfter).question:'';
    const freshGuideReply=!!sourceEditContext()&&Number.isFinite(run.recoveryRetryAfter)&&event.start_ms-run.recoveryRetryAfter>=1800;
    if (Number.isFinite(run.recoveryRetryAfter) && (discoveryRequest(retryQuestion)||sourceGuideRequest(retryQuestion)||freshGuideReply)) {
     run.recoveryAttempts = 0; run.recoveryRetryAfter = null; run.recoveryTurnId = `utterance_${crypto.randomUUID()}`; run.recoveryNeeded = true;
    }
    if (!run.pending && run.recoveryAttempts<2 && needsBackend(speechRequest(run.transcript.entries(),run.answeredOffset).question)) run.recoveryNeeded = true;
    scheduleRecovery(run);
    scheduleChart(run);
    phase(run, 'listening', { reason: 'input-transcript' });
   }
   else { window.WI_VOICE_GUIDE?.speak(event.delta); phase(run, 'speaking'); }
   notify('wi-voice-transcript', { text: event.delta, role: event.type === 'session.input_transcript.delta' ? 'user' : 'assistant', turnId: run.turnId || null, ...(event.type === 'session.input_transcript.delta' ? { utteranceText: run.transcript.text('user', run.answeredOffset).slice(-2000), inputRevision: run.inputRevision } : {}) });
   $('#wl-user-caption').textContent = run.transcript.text('user').slice(-10000) || 'Waiting for speech…';
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
 function welcome(run) {
  if (!current(run) || closing || !run.ready || !run.remoteStream || !run.playbackAttempted || run.playbackBlocked || run.playbackPaused || run.welcomed) return;
  run.welcomed = true;
  if (run.inputRevision) return; // A caller's question takes priority over an intro.
  run.welcomeAttempts = (run.welcomeAttempts || 0) + 1;
  send(run, { type: 'session.commentary.append', event_id: `welcome_${crypto.randomUUID()}`, delegation_id: null, content: 'Welcome to Workforce Studio. I’m your AI workforce collaborator. This page uses synthetic data. Speak or type to explore workforce signals, compare teams, and test decisions. I’ll bring the evidence into view as we talk. What would you like to explore?' });
 }
 function scheduleWelcome(run) {
  if (!current(run) || closing || run.welcomed || run.welcomeTimer) return;
  // A remote play() can wait for first RTP. Waiting for its fulfillment before
  // requesting the first speech would deadlock. Let immediate policy rejection
  // settle first, then inject the app-owned introduction on the real session.
  run.welcomeTimer = setTimeout(() => { run.welcomeTimer = null; welcome(run); }, 100);
 }
 function finishLocally(run, message) {
  if (!current(run)) return;
  autoRequested = false; autoConsumed = true;
  try { command(run, 'session.close'); } catch {}
  void serverClose(run.sessionId);
  reportUsage(run); release(run); state(message + ' Microphone released. Final session usage is unconfirmed.');
  phase(null, 'stopped', { message });
 }
 function playbackBlocked(run) {
  if (!current(run) || closing) return;
  if (run.welcomed && !run.playbackReady && !run.inputRevision && run.welcomeAttempts < 2) run.welcomeNeedsReplay = true;
  if (!run.playbackBlocked) run.autoMuted = !run.muted;
  run.playbackBlocked = true; run.playbackReady = false; run.muted = true;
  run.stream?.getTracks().forEach(track => { track.enabled = false; }); micStatus(run);
  const message = 'Your browser paused voice playback. Select Enable audio to hear the welcome. The microphone is muted; Stop ends the session.';
  $('#wl-playback').textContent = 'Press Play or Enable audio to hear the AI voice'; state(message);
  phase(run, 'listening', { reason: 'playback-blocked', action: 'enable-audio', message });
  if (!run.playbackTimer) run.playbackTimer = setTimeout(() => finishLocally(run, 'Voice stopped because audio playback was not enabled. Select Talk to reconnect.'), 15000);
 }
 function playbackReady(run) {
  const audio = $('#wl-audio');
  if (!current(run) || closing) { if (run.remoteStream && audio.srcObject === run.remoteStream) audio.pause(); return; }
  if (!run.remoteStream || audio.srcObject !== run.remoteStream || audio.paused) return;
  const wasBlocked = run.playbackBlocked;
  clearTimeout(run.playbackTimer); run.playbackTimer = null; run.playbackBlocked = false; run.playbackReady = true;
  if (run.autoMuted) { run.autoMuted = false; run.muted = false; run.stream?.getTracks().forEach(track => { track.enabled = true; }); micStatus(run); }
  $('#wl-playback').textContent = 'AI voice playback active';
  if (run.welcomeNeedsReplay) { run.welcomeNeedsReplay = false; run.welcomed = false; }
  scheduleWelcome(run);
  if (wasBlocked && run.ready) { state('Connected. You can speak and interrupt naturally.'); phase(run, 'listening', { action: null }); }
 }
 async function enableAudio() {
  const run = active; if (!run?.remoteStream || closing) return;
  run.playbackPaused = false; run.playbackAttempted = true;
  const playing = $('#wl-audio').play(); scheduleWelcome(run);
  try { await playing; playbackReady(run); } catch { playbackBlocked(run); }
 }
 async function tryAutostart() {
  if (!autoRequested || autoConsumed || !availabilityChecked) return;
  autoRequested = false; autoConsumed = true;
  if (document.visibilityState === 'hidden' || /(?:^\?|&)voice=manual(?:&|$)/.test(window.location?.search || '') || window.WI_STUDIO?.isHome?.() !== true) return;
  if (!available) { phase(null, 'idle', { reason: 'unavailable', message: $('#wl-state').textContent }); return; }
  return start({ automatic: true });
 }
 function autostart() { if (autoConsumed) return; autoRequested = true; return tryAutostart(); }
 async function start(options = {}) {
  if (active || !available || closing || document.visibilityState === 'hidden') return;
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
   const message = 'Continuous voice needs a WebRTC browser with microphone access on localhost or HTTPS. You can still type a question.';
   state(message); phase(null, 'idle', { reason: 'unsupported-browser', message }); return;
  }
  window.dispatchEvent(new Event('wi-stop-media')); api()?.cancel?.();
  const run = { serial: ++serial, automatic: options.automatic === true, stage:'workspace.authentication', sessionRequested:false, pc: null, stream: null, channel: null, ready: false, muted: false, welcomed: false, playbackReady: false, playbackBlocked: false, sessionId: null, pending: null, startControl: new AbortController(), seconds: null, transcript: timeline(), inputRevision: 0, delegationOrder: 0, answeredOffset: -1, seenDelegations: new Set(), turnId: null, beats: null, recoveryNeeded: false, recoveryAttempts: 0, recoveryTimer: null, delegationTimer: null };
  lastClientFailure = null;
  active = run; controls(); state('Checking workspace sign-in…'); phase(run, 'connecting'); $('#wl-signin').hidden = true; $('#wl-result').textContent = 'Waiting for your question.';
  $('#wl-user-caption').textContent = 'Your speech will appear here.'; reportUsage(run);
  run.startTimer = setTimeout(() => failed(run, 'Conversation startup timed out.'),45000);
  try {
   const authenticated = await fetch('/api/status', { signal: run.startControl.signal, cache: 'no-store' });
   if (!authenticated.ok) { run.failureCode = `HTTP_${authenticated.status}`; throw Error(authenticated.status === 401 ? 'Your workspace sign-in expired. Reload this page and sign in again to continue voice.' : 'Could not verify workspace access. Refresh this page and try again.'); }
   if (!current(run) || closing) return;
   run.stage = 'browser.microphone'; state('Allow microphone access to hear your welcome. You can cancel with Stop.');
   phase(run, 'connecting', { reason: 'microphone-permission', message: $('#wl-state').textContent });
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
    if (!current(run) || closing) { event.track.stop(); return; }
    const audio = $('#wl-audio'); run.remoteStream = event.streams[0] || new MediaStream([event.track]); audio.srcObject = run.remoteStream;
    run.playbackAttempted = true; run.playbackPaused = false;
    const playing = audio.play(); scheduleWelcome(run);
    try { await playing; playbackReady(run); }
    catch { playbackBlocked(run); }
   };
   stream.getTracks().forEach(track => pc.addTrack(track,stream));
   const channel = pc.createDataChannel('oai-events'); run.channel = channel;
   channel.onmessage = e => { if (typeof e.data !== 'string' || e.data.length > 128000) return; try { eventReceived(run,JSON.parse(e.data)); } catch { failed(run,'Invalid voice event received.'); } };
   channel.onerror = () => failed(run,'The voice event channel failed.'); channel.onclose = () => failed(run,'The voice event channel closed before finalization.');
   state('Connecting microphone and AI voice…');
   const offer = await pc.createOffer(); if (!current(run)) return; await pc.setLocalDescription(offer); await waitICE(pc,run.startControl.signal);
   if (!current(run) || closing) return;
   run.stage = 'server.live_session'; run.sessionRequested = true;
   const res = await fetch('/api/live/session',{method:'POST',headers:{'Content-Type':'application/json'},signal:run.startControl.signal,body:JSON.stringify({sdp:pc.localDescription.sdp,scope:scope(),context:context(),history:history(),viewContext:viewContext(),reportContext:reportContext(),presentationPreferences:presentationPreferences(),sourceEditContext:sourceEditContext()})});
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
   if (!current(run) || closing) return;
   run.stage = 'voice.awaiting_start';
   run.maxTimer = setTimeout(() => { if (current(run)) stop('The 15-minute session limit was reached. Finishing conversation…'); }, Math.min(data.maxSessionMs || 900000,900000) - 15000);
   // HTTP already started this session. session.start must not be sent here.
  } catch (error) {
   if (!current(run)) return;
   if (run.automatic && error.name === 'NotAllowedError' && !run.sessionRequested) {
    const message = 'Microphone access was not allowed. Allow this site’s microphone in your browser, then select Talk to try again. You can also type a question.';
    release(run); state(message); phase(null, 'idle', { reason: 'permission-required', action: 'start', message });
   } else failed(run,error.name === 'NotAllowedError' ? 'Microphone permission was denied.' : error.message || 'Could not start continuous voice.');
  }
 }
 $('#wl-start').addEventListener('click',start); $('#wl-stop').addEventListener('click',() => stop());
 $('#wl-check').addEventListener('click',checkConnection); $('#wl-report').addEventListener('click',downloadReport);
 $('#wl-close').addEventListener('click',closePanel);
 $('#wl-signin').addEventListener('click',() => window.location.reload());
 host.addEventListener('keydown',event => { if (event.key === 'Escape') { event.preventDefault?.(); closePanel(); } });
 $('#wl-mute').addEventListener('click',() => {
  const run = active; if (!run?.ready || closing) return;
  run.muted = !run.muted; run.stream?.getAudioTracks().forEach(track => { track.enabled = !run.muted; }); micStatus(run);
  run.autoMuted = false;
  // Local track state is authoritative for this UI. No claim of server mute acknowledgment.
  state(run.muted ? 'Microphone muted locally. Voice session remains active and billed.' : 'Microphone active. You can speak.');
  phase(run, run.muted ? 'muted' : 'listening');
 });
 $('#wl-audio').addEventListener('playing',() => { if (active) playbackReady(active); });
 $('#wl-audio').addEventListener('pause',() => { if (active && $('#wl-audio').paused) { if (!closing) { active.playbackReady = false; active.playbackPaused = true; } $('#wl-playback').textContent = 'AI voice playback paused'; } });
 window.addEventListener('wi-stop-media',() => stop('Switching conversation mode. Finishing continuous voice…'));
 window.addEventListener('wi-source-updated',event => {
  const operation=active?.sourceOperation;
  if(operation&&event?.detail?.origin==='voice'&&event.detail.operationId===operation.operationId&&!operation.ctrl.signal.aborted){operation.refreshed=true;clearBeats(active);clearRecovery(active);clearChart(active);window.WI_VOICE_GUIDE?.stop();return;}
  stop('Source data refreshed. Finishing this conversation; start again using the new evidence.');
 });
 window.addEventListener('wi-context-changed',syncContext);
 window.addEventListener('wi-chart-type-changed',event=>{if(!['voice','preference'].includes(event?.detail?.origin||window.WI_ASSISTANT_ACTIONS?.actionOrigin?.()))syncContext({force:true});});
 window.addEventListener('wi-report-view-changed',event=>{if(event?.detail?.origin!=='voice')syncContext({force:true});});
 document.getElementById('wi-app')?.addEventListener?.('change',syncContext);
 window.addEventListener('offline',() => { if (active) failed(active,'Browser network connection is offline.'); });
 document.addEventListener?.('visibilitychange',() => {
  if (document.visibilityState !== 'hidden') return;
  autoRequested = false; autoConsumed = true;
  if (active) finishLocally(active, 'Voice stopped because this tab is hidden. Select Talk when you return to reconnect.');
 });
 window.addEventListener('pagehide',() => { const run = active; if (!run) return; try { command(run,'session.close'); } catch {} void serverClose(run.sessionId,true); phase(run, 'stopped'); release(run); });
 window.WI_LIVE = Object.freeze({ open: openPanel, close: closePanel, start, stop, autostart, enableAudio, syncContext, getState: () => snapshot(lastState), isActive: () => !!active });
 fetch('/api/status').then(res => { if (!res.ok) throw Object.assign(Error(),{status:res.status}); return res.json(); }).then(data => {
  available = data.live?.available === true || data.continuousVoice === true;
  availabilityChecked = true;
  $('#wl-version').textContent = typeof data.version === 'string' ? '· App ' + data.version : '';
  state(available ? 'Ready. Start a conversation to enable your microphone.' : 'Continuous voice is unavailable. Configure the server API key and GPT-Live access; typed questions remain available.'); controls(); void tryAutostart();
 }).catch(error => { available = false; availabilityChecked = true; $('#wl-signin').hidden = error.status !== 401; state(error.status === 401 ? 'Your workspace sign-in expired. Reload this page and sign in again to continue voice.' : 'Could not check continuous voice availability.'); controls(); void tryAutostart(); });
})();
