import http from 'node:http';
import { contextualPlan, contextualWorkflow, isCompoundRequest, inheritAssumptions, enrichAnswer } from './intelligence.mjs';
import { createCloudState } from './cloud-state.mjs';
import { investigationDraft } from './investigations.mjs';
import { readFile, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { answer, backAnswer, navigation, retentionExample, demoPlan, modelPlan, routingInstructions, routingSchema, validateRequest, exportDataset, hydrateDataset, effectiveAssumptions, scenario, descriptor, metricIds, scopeOf } from './engine.mjs';
import { createWorkday } from './workday.mjs';
import { createLiveService } from './live.mjs';
import { createReviewService } from './review.mjs';
import { createJournal } from './storage.mjs';
import { createAuth, loginPage } from './auth.mjs';
import { createDiagnostics, assertAPIKey, connectionError, applicationError, apiResponseError } from './diagnostics.mjs';

const VERSION = '2.0.1';
const FILES = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/index.html', ['index.html', 'text/html; charset=utf-8']]]);
for (const name of ['conversation','live','operations','workspace','investigations','experience','focus','voice-guide','studio','studio-charts']) for (const extension of ['js','css']) FILES.set(`/${name}.${extension}`, [`${name}.${extension}`, extension==='js'?'text/javascript; charset=utf-8':'text/css; charset=utf-8']);
const AUDIO = new Map([['audio/webm', 'webm'], ['audio/mp4', 'mp4'], ['audio/wav', 'wav'], ['audio/mpeg', 'mp3']]);
const fail = (status, message) => Object.assign(new Error(message), { status });
function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
async function body(req, max) {
  if (Number(req.headers['content-length']) > max) { req.resume(); throw fail(413, 'Request body is too large'); }
  const parts = []; let length = 0;
  for await (const part of req) { length += part.length; if (length > max) throw fail(413, 'Request body is too large'); parts.push(part); }
  if (!length) throw fail(400, 'Request body is empty');
  return Buffer.concat(parts);
}
async function readJSON(req, max = 24000) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw fail(415, 'Expected application/json');
  try {
    const value = JSON.parse((await body(req, max)).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'Expected a JSON object');
    return value;
  } catch (err) { if (err.status) throw err; throw fail(400, 'Invalid JSON'); }
}
async function boundedResponse(response, max) {
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw fail(502, 'Upstream response exceeded limits'); }
  const parts = []; let length = 0;
  if (!response.body) throw fail(502, 'Empty upstream response');
  for await (const part of response.body) { length += part.length; if (length > max) throw fail(502, 'Upstream response exceeded limits'); parts.push(Buffer.from(part)); }
  return Buffer.concat(parts);
}
export function createServer({ apiKey = process.env.OPENAI_API_KEY || '', fetchImpl = globalThis.fetch, timeoutMs = 45000, storageDir,
  password = '', publicOrigin = '', reviewApiKey = '', reviewModel = '', workday: suppliedWorkday, objectStore } = {}) {
  const mode = apiKey ? 'api' : 'demo';
  if (publicOrigin && !/^https?:\/\/[^/]+$/.test(publicOrigin)) throw Error('PUBLIC_ORIGIN must be an HTTP(S) origin without a path.');
  const auth = createAuth({ password, secure: publicOrigin.startsWith('https://') });
  const temporaryDir = !storageDir && !suppliedWorkday ? mkdtempSync(join(tmpdir(), 'chro-synthetic-')) : null;
  const journal = createJournal(storageDir, { objectStore }), workday = suppliedWorkday || createWorkday({ baseline: exportDataset(), storageDir: storageDir || temporaryDir, objectStore });
  const reviewer = createReviewService({ apiKey: reviewApiKey, model: reviewModel, fetchImpl });
  const diagnostics = createDiagnostics({ apiKey, fetchImpl, version: VERSION, timeoutMs: Math.min(timeoutMs,10000) });
  const owners = new Map(); let active = 0, shutdownPromise = null;
  const ready = Promise.all([journal.init(), workday.init()]);
  ready.catch(() => {});
  async function upstream(endpoint, payload, contentType, signal, max = 256000) {
    assertAPIKey(apiKey);
    let stage = `openai.${endpoint}.request`;
    try {
      const response = await fetchImpl(`https://api.openai.com/v1/${endpoint}`, {
        method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${apiKey}`, ...(contentType ? { 'Content-Type': contentType } : {}) }, body: payload, signal
      });
      stage = `openai.${endpoint}.response`;
      if (!response.ok) throw await apiResponseError(response, stage);
      return await boundedResponse(response, max);
    } catch (error) { throw connectionError(error, stage, signal); }
  }
  async function ask(input, signal) {
    let request; try { request = validateRequest(input); } catch (e) { throw fail(400, e.message); }
    const snapshot = workday.snapshot();
    if (input.sourceVersion && input.sourceVersion !== snapshot.sourceVersion) throw fail(409, 'The source data changed. Refresh the dataset and ask again.');
    if (request.context?.sourceVersion && request.context.sourceVersion !== snapshot.sourceVersion) throw fail(409, 'Conversation evidence belongs to an earlier source revision. Refresh and ask again.');
    hydrateDataset(snapshot);
    const nav = navigation(request.question);
    if (nav && !nav.target) {
      const result = backAnswer(request, mode);
      await journal.log('question.answered', { mode, action: 'back', metricId: null, caseId: null, sourceVersion: snapshot.sourceVersion });
      return result;
    }
    const routed = nav ? { ...request, question: nav.target } : request;
    const workflow = contextualWorkflow(routed);
    let plan = workflow?.at(-1)?.plan || (isCompoundRequest(routed)?{intent:'clarify',metricId:null,caseId:null,overrides:{}}:contextualPlan(routed));
    if (plan) { /* A validated analytical action needs no model routing. */ }
    else if (mode === 'demo' || retentionExample(routed.question)) plan = demoPlan(routed);
    else {
      const payload = { model: 'gpt-6-astra', reasoning: { effort: 'low' }, store: false, instructions: routingInstructions,
        input: JSON.stringify({ question: routed.question, scope: request.scope, context: request.context, history: request.history }),
        text: { format: { type: 'json_schema', name: 'chro_route', strict: true, schema: routingSchema } }, max_output_tokens: 2500 };
      const bytes = await upstream('responses', JSON.stringify(payload), 'application/json', signal);
      try {
        const result = JSON.parse(bytes);
        if (result.status !== 'completed') throw Error('Incomplete response');
        const texts = (result.output || []).filter(x => x.type === 'message').flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text);
        if (texts.length !== 1) throw Error('No unique output');
        plan = modelPlan(texts[0]);
      } catch { throw fail(502, 'The model did not return a valid supported plan. Try a specific metric or scenario.'); }
    }
    if (signal?.aborted) throw fail(499, 'Question cancelled');
    if (workday.snapshot().sourceVersion !== snapshot.sourceVersion) throw fail(409, 'Source data changed during analysis. Ask again using the refreshed data.');
    hydrateDataset(snapshot);
    plan = inheritAssumptions(request, plan);
    const result = enrichAnswer(request, answer(request, plan, mode));
    if (workflow?.length) {
      result.workflow = workflow.map(step => {const stepRequest=validateRequest({question:step.question,scope:step.scope});return enrichAnswer(stepRequest,answer(stepRequest,step.plan,mode));});
      const final = result.workflow.at(-1);
      Object.assign(result,final,{question:request.question,workflow:result.workflow});
    }
    if (nav) result.navigation = { type: 'back', target: nav.target, intent: plan.intent };
    await journal.log('question.answered', { mode, action: result.action.type, metricId: result.action.metricId, caseId: result.action.caseId, sourceVersion: snapshot.sourceVersion });
    return result;
  }
  const live = createLiveService({ apiKey, fetchImpl, ask });
  const server = http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer'); res.setHeader('x-frame-options', 'DENY');
    res.setHeader('permissions-policy', 'camera=(), microphone=(self)');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const controller = new AbortController(), cancel = () => { if (!res.writableEnded) controller.abort(); };
    req.on('aborted', cancel); res.on('close', cancel);
    let acquired = false, timer, requestPath = 'server.request';
    try {
      const port = server.address()?.port, allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
      if (publicOrigin) allowedHosts.push(new URL(publicOrigin).host);
      if (!allowedHosts.includes(req.headers.host)) throw fail(403, 'Host is not allowed');
      if (req.headers.origin && ![`http://${req.headers.host}`, publicOrigin].filter(Boolean).includes(req.headers.origin)) throw fail(403, 'Cross-origin requests are not allowed');
      const path = req.url?.split('?')[0];
      // Shared links may navigate from another site; API calls and embedded pages may not.
      const entryNavigation = req.method === 'GET' && ['/', '/index.html'].includes(path) && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']) && !entryNavigation) throw fail(403, 'Cross-site requests are not allowed');
      if (!path || path.includes('%') || path.includes('\\') || path.includes('..')) throw fail(404, 'Not found');
      if (FILES.has(path) || /^\/api\/(?:login|logout|status|ask|transcribe|speech|audit|decisions|investigations|review|live\/(?:session|delegate|close)|diagnostics(?:\/connection)?|workday\/(?:sync|status|report)|data\/snapshot|studio\/bootstrap)$/.test(path)) requestPath = FILES.has(path) ? 'static.asset' : path;
      if (path === '/health' && req.method === 'GET') { await ready; return json(res, 200, { ok: true, synthetic: true, version: VERSION }); }
      if (path === '/api/login' && req.method === 'POST') {
        const value = await readJSON(req, 3000);
        return json(res, 200, auth.enabled ? auth.login(req, value.password, res) : { authenticated: true, mode: 'local-demo' });
      }
      const identity = auth.identity(req);
      if (!identity) {
        if (req.method === 'GET' && ['/', '/index.html'].includes(path)) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(loginPage); }
        throw fail(401, 'Sign in to the workspace first.');
      }
      // Reports stay available to the signed-in user even if saved-state startup
      // failed. This read does not call OpenAI or include saved records.
      if (req.method === 'GET' && path === '/api/diagnostics') return json(res, 200, diagnostics.report());
      await ready;
      if(objectStore && (path.startsWith('/api/') || path==='/' || path==='/index.html'))await Promise.all([journal.refresh(),workday.refresh?.()]);
      if (req.method === 'POST' && path === '/api/logout') {
        for (const [id, owner] of owners) if (owner === identity) { await live.close(id).catch(() => {}); owners.delete(id); }
        auth.logout(req, res); return json(res, 200, { authenticated: false });
      }
      if (req.method === 'GET' && path === '/api/status') return json(res, 200, {
        version: VERSION, mode, voiceInput: mode === 'api', voiceOutput: mode === 'api', live: live.status(), review: reviewer.status(),
        workday: workday.status(), authentication: auth.enabled ? 'password' : 'local-demo', persistence: objectStore ? 'cloud-storage' : storageDir ? 'disk' : 'memory',
        disclosure: mode === 'api' ? 'Server key configured; entitlement needs a live test. GPT-Live continuous conversation and recorded GPT-Transcribe → Astra → AI speech are available to configure.' : 'Synthetic Workday-connected demo. No live model call. Browser voice is available where supported; real microphone transcription, continuous voice and narrated answers require API access.'
      });
      if (req.method === 'GET' && path === '/api/studio/bootstrap') {
        const snapshot=workday.snapshot();hydrateDataset(snapshot);
        const request=validateRequest({question:'Give me an overview'});
        const response=enrichAnswer(request,answer(request,{intent:'overview',metricId:null,caseId:null,overrides:{}},mode));
        return json(res,200,{response,catalog:metricIds.map(id=>{const d=descriptor(id,request.scope);return {id,label:d.label,definition:d.definition};})});
      }
      if (req.method === 'GET' && path === '/api/workday/status') return json(res, 200, workday.status());
      if (req.method === 'GET' && path === '/api/data/snapshot') return json(res, 200, workday.snapshot());
      if (req.method === 'GET' && path === '/api/workday/report') {
        const query = new URL(req.url, 'http://localhost').searchParams;
        try { return json(res, 200, await workday.report({ name: query.get('name') || 'CoreHCM', cursor: query.get('cursor') || undefined, limit: query.has('limit') ? Number(query.get('limit')) : undefined, batch: query.get('batch') || 'baseline' })); }
        catch (e) { throw fail(e.status || 400, e.message); }
      }
      if (req.method === 'GET' && path === '/api/investigations') return json(res, 200, { items: journal.investigations() });
      if (req.method === 'GET' && path === '/api/decisions') return json(res, 200, { items: journal.decisions() });
      if (req.method === 'GET' && path === '/api/audit') return json(res, 200, { events: journal.audit(), syncHistory: workday.status().history || [] });
      if (FILES.has(path)) {
        if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'Method not allowed');
        const [file, type] = FILES.get(path); let bytes = await readFile(new URL(`./public/${file}`, import.meta.url));
        if (file === 'index.html') {
          const snapshot = JSON.stringify(workday.snapshot()).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
          bytes = Buffer.from(bytes.toString().replace('<!-- wi-dataset-bootstrap -->', `<script id="wi-dataset-bootstrap">window.WI_DATA.hydrate(${snapshot});</script>`));
        }
        res.writeHead(200, { 'content-type': type, 'content-length': bytes.length }); return res.end(req.method === 'HEAD' ? undefined : bytes);
      }
      if (!['/api/ask','/api/transcribe','/api/speech','/api/workday/sync','/api/live/session','/api/live/delegate','/api/live/close','/api/decisions','/api/investigations','/api/review','/api/diagnostics/connection'].includes(path)) throw fail(404, 'Not found');
      if (req.method !== 'POST') throw fail(405, 'Method not allowed');
      if (active >= 4) throw fail(429, 'Too many active requests; try again shortly');
      active++; acquired = true; timer = setTimeout(() => controller.abort(new DOMException('Request timeout','TimeoutError')), timeoutMs); timer.unref();
      if (path === '/api/diagnostics/connection') {
        await readJSON(req,2000);
        return json(res,200,await diagnostics.check(controller.signal));
      }
      if (path === '/api/ask') return json(res, 200, await ask(await readJSON(req), controller.signal));
      if (path === '/api/workday/sync') {
        const input = await readJSON(req, 2000);
        if (!input || !['baseline','correction','invalid'].includes(input.batch)) throw fail(400, 'Choose a supported synthetic batch.');
        try { const result = await workday.sync(input); await journal.log('source.synced', { batch: input.batch, changed: result.changed, sourceVersion: result.snapshot.sourceVersion }); return json(res, 200, result); }
        catch (e) { await journal.log('source.rejected', { batch: input.batch }); throw fail(e.status || 422, e.message); }
      }
      if (path === '/api/live/session') {
        const result = await live.create(await readJSON(req, 120000), controller.signal); owners.set(result.session.id, identity);
        try { await journal.log('voice.started', { sessionId: result.session.id }); }
        catch (error) {
          owners.delete(result.session.id);
          await live.close(result.session.id).catch(() => {});
          throw applicationError(error,'live.session.journal');
        }
        // A cancelled browser must not leave a newly created server session open.
        if (controller.signal.aborted) {
          owners.delete(result.session.id); await live.close(result.session.id).catch(() => {});
          throw connectionError(new DOMException('Cancelled','AbortError'),'live.session.delivery',controller.signal);
        }
        return json(res, 201, result);
      }
      if (path === '/api/live/delegate' || path === '/api/live/close') {
        const input = await readJSON(req, 60000);
        if (owners.get(input.sessionId) !== identity) throw fail(404, 'Voice session not found');
        if (path.endsWith('delegate')) return json(res, 200, await live.delegate(input, controller.signal));
        const result = await live.close(input.sessionId, controller.signal); owners.delete(input.sessionId);
        await journal.log('voice.closed', { sessionId: input.sessionId, finalization: result.finalization }); return json(res, 200, result);
      }
      if (path === '/api/investigations') {
        const draft = investigationDraft(await readJSON(req, 100000), workday.snapshot());
        return json(res, 201, await journal.saveInvestigation(draft));
      }
      if (path === '/api/decisions') {
        const input = await readJSON(req, 250000), currentSnapshot = workday.snapshot(), sourceVersion = currentSnapshot.sourceVersion;
        if (input.sourceVersion && input.sourceVersion !== sourceVersion) throw fail(409, 'Refresh the source data before saving this draft.');
        let assumptions; try { assumptions = effectiveAssumptions(input.caseId, input.overrides); } catch (e) { throw fail(400, e.message); }
        const record = {};
        for (const field of ['rationale','dissent','owner','reviewDate','stopGate']) {
          const value = input.record?.[field] ?? '';
          if (typeof value !== 'string' || value.length > 4000) throw fail(400, 'Draft fields must contain at most 4000 characters.');
          record[field] = value;
        }
        hydrateDataset(currentSnapshot);
        const freezeEvidence = ref => {
          if (!ref || !metricIds.includes(ref.metricId)) throw fail(400, 'Invalid pinned metric reference');
          if (ref.sourceVersion && ref.sourceVersion !== sourceVersion) throw fail(409, 'Pinned evidence belongs to an older source revision. Reopen and repin that observation before saving.');
          let scope; try { scope = scopeOf(ref.scope); } catch (e) { throw fail(400, e.message); }
          const d = descriptor(ref.metricId, scope), formatted = answer({question:`Explain ${d.id}`,scope}, {intent:'metric',metricId:d.id,caseId:null,overrides:{}}, 'demo').facts[0].value;
          return {key:[d.id,scope.function,scope.region,scope.period].join('|'),metricId:d.id,metricLabel:d.label,formatted,value:d.value,unit:d.unit,numerator:d.numerator??null,denominator:d.denominator??null,definition:d.definition,period:d.period,scope,scopeLabel:[scope.function,scope.region,scope.period].join(' · '),snapshot:currentSnapshot.asOf,sourceVersion};
        };
        if (!Array.isArray(input.evidenceLedger ?? []) || (input.evidenceLedger || []).length > 50) throw fail(400, 'A draft may contain up to 50 pinned observations.');
        const evidenceLedger = (input.evidenceLedger || []).map(freezeEvidence);
        const context = input.context ? freezeEvidence(input.context) : null;
        const captures = input.record?.snapshots ?? [];
        if (!Array.isArray(captures) || captures.length > 50) throw fail(400, 'A draft may contain up to 50 assumption captures.');
        record.snapshots = captures.map((capture,index) => {
          if (!capture || typeof capture !== 'object' || Array.isArray(capture) || capture.caseId !== input.caseId) throw fail(400, 'Captured assumptions must belong to this decision case.');
          const keys = Object.keys(effectiveAssumptions(input.caseId));
          let captured; try { captured = effectiveAssumptions(input.caseId, Object.fromEntries(keys.filter(key => capture.assumptions?.[key] !== undefined).map(key => [key,capture.assumptions[key]]))); } catch (e) { throw fail(400,e.message); }
          const result = scenario(input.caseId,captured);
          return {version:index+1,capturedAt:typeof capture.capturedAt==='string'?capture.capturedAt.slice(0,64):null,caseId:input.caseId,funding:result.firstYearFunding,assumptions:captured,calculated:{[input.caseId]:result}};
        });
        const saved = await journal.save({ caseId: input.caseId, assumptions, calculated: scenario(input.caseId, assumptions), record, context, evidenceLedger, sourceVersion });
        return json(res, 201, saved);
      }
      if (path === '/api/review') {
        const input = await readJSON(req, 2000), draft = journal.get(input.id);
        if (!draft) throw fail(404, 'Save the decision draft before requesting review.');
        const reviewDraft = {
          caseId:draft.caseId, assumptions:draft.assumptions, calculated:draft.calculated, sourceVersion:draft.sourceVersion,
          context:draft.context, evidenceLedger:draft.evidenceLedger,
          record:Object.fromEntries(['rationale','dissent','owner','reviewDate','stopGate'].map(key => [key,draft.record[key]]))
        };
        const result = await reviewer.review(reviewDraft, controller.signal);
        return json(res, 200, await journal.attachReview(draft.id, result));
      }
      if (mode !== 'api') throw fail(503, 'Voice API is unavailable in demo mode. Configure OPENAI_API_KEY on the server.');
      if (path === '/api/transcribe') {
        const type = req.headers['content-type']?.split(';')[0].trim();
        if (!AUDIO.has(type)) throw fail(415, 'Expected audio/webm, audio/mp4, audio/wav, or audio/mpeg');
        const bytes = await body(req, 12 * 1024 * 1024), form = new FormData(); form.append('model', 'gpt-transcribe');
        form.append('file', new Blob([bytes], { type }), `recording.${AUDIO.get(type)}`);
        const result = await upstream('audio/transcriptions', form, undefined, controller.signal);
        let transcript; try { transcript = JSON.parse(result).text; } catch {}
        if (typeof transcript !== 'string' || transcript.length > 10000) throw fail(502, 'Invalid transcription response');
        return json(res, 200, { text: transcript });
      }
      const speech = await readJSON(req, 16000);
      if (!speech || typeof speech.text !== 'string' || !speech.text.trim() || speech.text.length > 3000) throw fail(400, 'Speech text must contain 1–3000 characters');
      const audio = await upstream('audio/speech', JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'marin', input: speech.text, response_format: 'mp3', instructions: 'Speak clearly and calmly as a concise business briefing.' }), 'application/json', controller.signal, 8 * 1024 * 1024);
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': audio.length }); return res.end(audio);
    } catch (err) {
      if (err.diagnostic || !err.status) {
        const detail = diagnostics.record(err,requestPath);
        if (!res.destroyed && !res.writableEnded) json(res,controller.signal.aborted ? 504 : err.status || 500,{error:detail.message,code:detail.category,diagnosticId:detail.id,stage:detail.stage || requestPath});
      } else if (!res.destroyed && !res.writableEnded) json(res,controller.signal.aborted ? 504 : err.status,{error:controller.signal.aborted ? 'Request timed out or was cancelled' : err.message});
    } finally { clearTimeout(timer); if (acquired) active--; req.off('aborted', cancel); res.off('close', cancel); }
  });
  server.ready = ready;
  server.requestTimeout = 60000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.on('close', () => {
    shutdownPromise = (async () => {
      while (active > 0) await new Promise(resolve => setTimeout(resolve,10));
      await live.shutdown(); await journal.settled();
      if (temporaryDir) await rm(temporaryDir, { recursive:true, force:true });
    })();
    shutdownPromise.catch(() => {});
  });
  server.whenClosed = () => shutdownPromise || Promise.resolve();
  return server;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.PORT || 8787), host = process.env.BIND_HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT must be an integer from 1 to 65535');
  if (!['127.0.0.1','::1','0.0.0.0'].includes(host)) throw Error('BIND_HOST must be 127.0.0.1, ::1 or 0.0.0.0');
  if (host === '0.0.0.0' && !process.env.APP_PASSWORD) throw Error('Set APP_PASSWORD before binding beyond loopback.');
  const objectStore=process.env.STATE_BUCKET?createCloudState({bucket:process.env.STATE_BUCKET,prefix:process.env.STATE_PREFIX||'chro'}):undefined;
  const server = createServer({ objectStore, storageDir: resolve(process.env.STATE_DIR || '.state'), password: process.env.APP_PASSWORD || '', publicOrigin: process.env.PUBLIC_ORIGIN || '', reviewApiKey: process.env.ANTHROPIC_API_KEY || '', reviewModel: process.env.ANTHROPIC_MODEL || '' });
  await server.ready;
  server.listen(port, host, () => console.log(`Workforce Intelligence at ${process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`} (synthetic Workday data)`));
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { server.closeAllConnections(); server.close(async () => { try { await server.whenClosed(); process.exit(0); } catch { process.exit(1); } }); });
}
