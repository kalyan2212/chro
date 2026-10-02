import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { retentionExample } from '../engine.mjs';

async function setup(t, options = {}) {
  const server = createServer({ apiKey: '', ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
const post = (url, path, body, headers = {}) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const raw = (url, options) => new Promise((resolve, reject) => { const req = http.request(url, options, res => { const parts = []; res.on('data', x => parts.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts).toString() })); }); req.on('error', reject); req.end(); });
function mockAnalyst(name,args,observed=[]){return async(endpoint,init)=>{
  const payload=JSON.parse(init.body);observed.push({endpoint,payload});
  const outputs=payload.input.filter(item=>item.type==='function_call_output');
  if(!outputs.length)return Response.json({status:'completed',output:[{type:'function_call',call_id:'test_call',name,arguments:JSON.stringify(args)}]});
  const items=outputs.flatMap(item=>JSON.parse(item.output).items||[]),item=items[0];
  assert.ok(item?.response,'Mock must receive calculated tool evidence');
  const analysis={headline:'Evidence and next steps',summary:'The workspace evidence supports a scoped review, with assumptions kept explicit.',sections:[{kind:'finding',title:item.title,text:`${item.response.facts[0].label}: ${item.response.facts[0].value}.`,evidenceRefs:[item.refId]},{kind:'recommendation',title:'Validate before acting',text:'Check the assumptions before selecting the next step.',evidenceRefs:[item.refId]}],unknowns:[],followups:['What additional evidence would distinguish the explanations?'],panels:[{evidenceRef:item.refId,title:item.title,why:'Inspect the calculated evidence.'}]};
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(analysis)}]}]});
};}
test('demo server serves UI and grounded questions without upstream calls', async t => {
  const { url } = await setup(t, { fetchImpl: () => { throw new Error('Unexpected network'); } });
  const status = await (await fetch(url + '/api/status')).json(); assert.equal(status.mode, 'demo'); assert.equal(status.voiceInput, false);
  const page = await fetch(url); assert.equal(page.status, 200); assert.match(await page.text(), /wi-source-data-js/);
  const res = await post(url, '/api/ask', { question: 'Explain first-year retention' });
  const a = await res.json(); assert.equal(res.status, 200); assert.equal(a.mode, 'demo'); assert.equal(a.facts[0].value, '14.0%');
  assert.equal((await post(url, '/api/transcribe', {})).status, 503);
});
test('host, origin, paths, methods, content types and body sizes are guarded', async t => {
  const { url } = await setup(t);
  assert.equal((await raw(url + '/api/status', { headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await post(url, '/api/ask', { question: 'P01' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(url, '/api/ask', { question: 'P01' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  for (const path of ['/server.mjs', '/.env', '/%2e%2e/server.mjs', '/api/nope']) assert.equal((await fetch(url + path)).status, 404);
  assert.equal((await fetch(url + '/api/ask')).status, 405);
  assert.equal((await post(url, '/api/ask', { question: 'P01' }, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post(url, '/api/ask', { question: 'x'.repeat(30000) })).status, 400);
  assert.equal((await post(url, '/api/ask', { question: 'x'.repeat(9_000_000) })).status, 413);
  assert.equal((await post(url, '/api/ask', { question: 'P01', scope: { function: 'invalid' } })).status, 400);
  const malformed = await fetch(url + '/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }); assert.equal(malformed.status, 400);
});
test('mocked API uses an Astra tool loop and composes explanations from local calculations', async t => {
  const calls = [];
  const { url } = await setup(t, { apiKey: 'TEST_ONLY_NEVER_SENT', fetchImpl:mockAnalyst('calculate_scenario',{caseId:'retention',overrides:{effect:.5}},calls) });
  const res = await post(url, '/api/ask', { question: 'What if improvement is half a percentage point?' }); const result = await res.json();
  assert.equal(res.status, 200); assert.equal(result.mode, 'api'); assert.equal(result.facts.find(f => f.label === 'Net modeled value').value, '−$90k');
  assert.equal(calls[0].endpoint, 'https://api.openai.com/v1/responses');
  const payload = calls[0].payload; assert.equal(payload.model, 'gpt-6-astra'); assert.equal(payload.reasoning.effort,'medium'); assert.equal(payload.store, false); assert.equal(payload.text.format.strict, true);
  assert.equal(calls.length,2);assert.equal(result.analysis.sections[1].kind,'recommendation');assert.ok(result.evidenceReferences.length);
  assert.ok(!JSON.stringify(result).includes('TEST_ONLY')); assert.ok(!JSON.stringify(payload.input).includes('"cells"'));
});
test('invalid, refused and failed upstream outputs fail closed', async t => {
  const { url } = await setup(t, { apiKey: 'TEST_ONLY', fetchImpl: async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"answer":"Made-up facts"}' }] }] }) });
  const res = await post(url, '/api/ask', { question: 'P01' }); assert.equal(res.status, 502); assert.ok(!JSON.stringify(await res.json()).includes('Made-up'));
});
test('mocked audio endpoints use recorded audio and AI narration models', async t => {
  const calls = [];
  const { url } = await setup(t, { apiKey: 'TEST_ONLY', fetchImpl: async (endpoint, init) => {
    calls.push({ endpoint, init });
    return endpoint.endsWith('transcriptions') ? Response.json({ text: 'Explain P01' }) : new Response(Buffer.from('MOCK_MP3'), { headers: { 'content-type': 'audio/mpeg' } });
  } });
  const transcript = await fetch(url + '/api/transcribe', { method: 'POST', headers: { 'content-type': 'audio/webm;codecs=opus' }, body: Buffer.from('MOCK_AUDIO') });
  assert.deepEqual(await transcript.json(), { text: 'Explain P01' }); assert.equal(calls[0].init.body.get('model'), 'gpt-transcribe');
  const audio = await post(url, '/api/speech', { text: 'All figures are synthetic.' }); assert.equal(audio.headers.get('content-type'), 'audio/mpeg'); assert.equal(await audio.text(), 'MOCK_MP3');
  assert.equal(JSON.parse(calls[1].init.body).model, 'gpt-4o-mini-tts');
  assert.equal((await post(url, '/api/speech', { text: 'x'.repeat(3001) })).status, 400);
  assert.equal((await fetch(url + '/api/transcribe', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'bad' })).status, 415);
});
test('upstream timeout cancels and returns a bounded safe error', async t => {
  const { url } = await setup(t, { apiKey: 'TEST_ONLY', timeoutMs: 20, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('SECRET_SHOULD_NOT_LEAK')), { once: true })) });
  const res = await post(url, '/api/ask', { question: 'P01' }); assert.equal(res.status, 504); assert.ok(!(await res.text()).includes('SECRET'));
});

test('shared links reach sign-in while cross-site APIs, frames and posts stay blocked', async t => {
  const {url}=await setup(t,{password:'synthetic-password-for-tests'});
  const headers={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document',referer:'https://example.org/'};
  for(const path of ['/','/index.html?shared=1']){const response=await raw(url+path,{headers});assert.equal(response.status,200);assert.match(response.body,/Enter your workspace/);assert.doesNotMatch(response.body,/wi-source-data-js/);}
  assert.equal((await raw(url+'/',{headers:{...headers,'sec-fetch-site':'same-site'}})).status,200);
  for(const path of ['/api/status','/api/investigations','/api/decisions'])assert.equal((await raw(url+path,{headers})).status,403);
  assert.equal((await raw(url+'/',{headers:{...headers,'sec-fetch-dest':'iframe'}})).status,403);
  assert.equal((await raw(url+'/',{headers:{...headers,'sec-fetch-mode':'cors'}})).status,403);
  assert.equal((await raw(url+'/',{method:'POST',headers})).status,403);
  assert.equal((await raw(url+'/api/login',{method:'POST',headers})).status,403);
  assert.equal((await raw(url+'/',{headers:{...headers,origin:'https://example.org'}})).status,403);
});

test('go back needs no provider call; a named target can invoke the analytical tool loop', async t => {
  const calls = [];
  const { url } = await setup(t, { apiKey: 'TEST_ONLY_NEVER_SENT', fetchImpl:mockAnalyst('inspect_metrics',{metricIds:['C01'],scope:{function:'all',region:'all',period:'quarter'}},calls) });
  const back = await (await post(url, '/api/ask', { question: 'Go back' })).json();
  assert.equal(calls.length, 0); assert.equal(back.action.type, 'back'); assert.deepEqual(back.navigation, { type: 'back', target: false });
  const named = await (await post(url, '/api/ask', { question: 'Take me back to first-year retention' })).json();
  assert.equal(calls.length, 2); assert.ok(JSON.stringify(calls[0].payload.input).includes('first-year retention'));
  assert.equal(named.action.metricId, 'C01'); assert.equal(named.facts[0].value, '14.0%');
});
test('demo mode resolves a named back target locally', async t => {
  const { url } = await setup(t, { fetchImpl: () => { throw new Error('Unexpected network'); } });
  const named = await (await post(url, '/api/ask', { question: 'go back to the HR service queue' })).json();
  assert.equal(named.navigation.intent, 'metric'); assert.equal(named.action.metricId, 'O04');
  const unknown = await (await post(url, '/api/ask', { question: 'go back to the share price' })).json();
  assert.equal(unknown.navigation.intent, 'clarify');
});

test('mocked API compares metrics while the server computes every segment', async t => {
  const { url } = await setup(t, { apiKey: 'TEST_ONLY_NEVER_SENT', fetchImpl:mockAnalyst('compare_metrics',{metricIds:['E03'],dimension:'region',scope:{function:'all',region:'all',period:'quarter'}}) });
  const res = await post(url, '/api/ask', { question: 'Where is attrition highest?' }); const a = await res.json();
  assert.equal(res.status, 200); assert.equal(a.action.type, 'breakdown'); assert.equal(a.breakdown.rows.length, 4);
  assert.ok(a.breakdown.rows.every(row=>Number.isFinite(row.value)));assert.ok(a.analysis.sections.length);
});

test('explicit UI scenario recalculation remains deterministic in API mode', async t => {
 const {url}=await setup(t,{apiKey:'sk-test-not-used',fetchImpl:()=>{throw Error('Standard example must not call a router');}});
 const res=await post(url,'/api/ask',{question:'Recalculate the retention scenario with these assumptions',operation:'calculate',context:{caseId:'retention',overrides:{effect:.5,programCost:240000,replacementCost:25000}}});
 assert.equal(res.status,200);const data=await res.json();assert.equal(data.action.type,'scenario');assert.equal(data.action.overrides.effect,.5);assert.match(JSON.stringify(data.facts),/90/);
});

test('retention shortcut preserves ambiguity and does not discard other assumptions',()=>{
 assert.equal(retentionExample('model retention with 0.5%'),'ambiguous');
 for(const q of ['Model retention with 0.5 percentage points and cost 100000','Model retention with 0.5 relative percent','Model retention with 5 percentage points','Model retention with 0.5 percentage points for individual employees'])assert.equal(retentionExample(q),null);
});
