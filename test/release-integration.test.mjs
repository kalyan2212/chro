import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';

const scope = { function: 'Engineering', region: 'EMEA', period: '2026-09' };
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const noUpstream = () => { throw Error('Unexpected external request in integration test'); };
const post = (url, path, value, cookie) => fetch(url + path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(value)
});
async function json(response, expected = 200) {
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
async function fixture(t, options = {}) {
  const storageDir = await mkdtemp(join(tmpdir(), 'chro-release-test-'));
  const servers = [];
  async function start(extra = {}) {
    const server = createServer({ apiKey: '', fetchImpl: noUpstream, storageDir, ...options, ...extra });
    servers.push(server);
    await server.ready;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, url: `http://127.0.0.1:${server.address().port}` };
  }
  async function close(server) {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    await server.whenClosed();
  }
  t.after(async () => { for (const server of servers) await close(server); await rm(storageDir, { recursive: true, force: true }); });
  return { ...(await start()), start, close };
}
const target = snapshot => snapshot.cells.find(row => row.month === scope.period && row.function === scope.function && row.region === scope.region);
const bootstrap = html => JSON.parse(html.match(/<script id="wi-dataset-bootstrap">window\.WI_DATA\.hydrate\(([\s\S]*?)\);<\/script>/)?.[1] || 'null');

test('HTTP source refresh changes the governed P07 answer, rejects stale questions, and bootstraps the committed snapshot', async t => {
  const { url } = await fixture(t);
  const before = await json(await fetch(url + '/api/data/snapshot'));
  const beforeAnswer = await json(await post(url, '/api/ask', { question: 'Explain P07', scope, sourceVersion: before.sourceVersion }));
  const baseline = await json(await post(url, '/api/workday/sync', { batch: 'baseline' }));
  assert.equal(baseline.changed, false);
  const correction = await json(await post(url, '/api/workday/sync', { batch: 'correction' }));
  assert.equal(correction.changed, true);
  assert.equal(target(correction.snapshot).flow.goalsSubmitted, target(before).flow.goalsSubmitted + 17);
  assert.equal(target(correction.snapshot).flow.goalsEligible, target(before).flow.goalsEligible);
  const stale = await post(url, '/api/ask', { question: 'Explain P07', scope, sourceVersion: before.sourceVersion });
  await json(stale, 409);
  const afterAnswer = await json(await post(url, '/api/ask', { question: 'Explain P07', scope, sourceVersion: correction.snapshot.sourceVersion }));
  const expected = (target(correction.snapshot).flow.goalsSubmitted / target(correction.snapshot).flow.goalsEligible * 100).toFixed(1) + '%';
  assert.equal(afterAnswer.facts[0].value, expected);
  assert.notEqual(afterAnswer.facts[0].value, beforeAnswer.facts[0].value);
  assert.equal(afterAnswer.sourceVersion, correction.snapshot.sourceVersion);
  const duplicate = await json(await post(url, '/api/workday/sync', { batch: 'correction' }));
  assert.equal(duplicate.changed, false);
  await json(await post(url, '/api/workday/sync', { batch: 'invalid' }), 422);
  assert.deepEqual(await json(await fetch(url + '/api/data/snapshot')), correction.snapshot);
  const status = await json(await fetch(url + '/api/workday/status'));
  assert.equal(status.lastAttempt.result, 'rejected');
  assert.equal(status.lastSuccess.batch, 'correction');
  const page = await fetch(url + '/');
  assert.equal(page.status, 200);
  assert.deepEqual(bootstrap(await page.text()), correction.snapshot);
  for (const asset of ['conversation', 'live', 'operations', 'workspace']) for (const extension of ['js', 'css']) {
    const response = await fetch(`${url}/${asset}.${extension}`);
    assert.equal(response.status, 200, `${asset}.${extension}`);
    assert.ok((await response.text()).length > 0);
  }
});

test('saved scenarios preserve trusted evidence, captures, and rules review across a server restart', async t => {
  const f = await fixture(t);
  const correction = await json(await post(f.url, '/api/workday/sync', { batch: 'correction' }));
  const sourceVersion = correction.snapshot.sourceVersion;
  const evidence = { metricId: 'P07', scope, sourceVersion, value: 999999, numerator: 999999, formatted: 'forged' };
  const payload = {
    caseId: 'retention', sourceVersion, overrides: { effect: 0.5, programCost: 240000, replacementCost: 25000 },
    calculated: { net: 99999999 }, context: evidence, evidenceLedger: [evidence],
    record: { rationale: 'Bounded pilot', dissent: 'Yield remains unproven', owner: 'Synthetic HR role', reviewDate: '2026-12-01', stopGate: 'Review the matured cohort',
      snapshots: [{ version: 90, caseId: 'retention', capturedAt: '2026-09-25T10:00:00.000Z', assumptions: { effect: 3, programCost: 240000, replacementCost: 25000 }, funding: 1, calculated: { retention: { net: 123 } } }] }
  };
  const saved = await json(await post(f.url, '/api/decisions', payload), 201);
  assert.equal(saved.status, 'draft-unapproved');
  assert.equal(saved.calculated.avoided, 6);
  assert.equal(saved.calculated.net, -90000);
  assert.equal(saved.record.dissent, payload.record.dissent);
  assert.equal(saved.context.numerator, target(correction.snapshot).flow.goalsSubmitted);
  assert.notEqual(saved.context.formatted, 'forged');
  assert.deepEqual(saved.evidenceLedger[0], saved.context);
  assert.equal(saved.record.snapshots[0].funding, 240000);
  assert.equal(saved.record.snapshots[0].calculated.retention.net, 660000);
  const repeated = await json(await post(f.url, '/api/decisions', payload), 201);
  assert.equal(repeated.id, saved.id, 'replaying the same save must not duplicate a draft');
  const reviewed = await json(await post(f.url, '/api/review', { id: saved.id }));
  assert.equal(reviewed.review.mode, 'rules');
  assert.ok(reviewed.review.review.questions.length > 0);
  assert.deepEqual(reviewed.calculated, saved.calculated);
  await f.close(f.server);
  const restarted = await f.start();
  const items = (await json(await fetch(restarted.url + '/api/decisions'))).items;
  assert.deepEqual(items, [reviewed]);
  assert.deepEqual(await json(await fetch(restarted.url + '/api/data/snapshot')), correction.snapshot);
  const audit = await json(await fetch(restarted.url + '/api/audit'));
  assert.equal(audit.events.filter(event => event.type === 'decision.saved').length, 1);
  assert.equal(audit.events.filter(event => event.type === 'decision.reviewed').length, 1);
  assert.ok(audit.syncHistory.some(event => event.batch === 'correction' && event.result === 'applied'));
  await json(await post(restarted.url, '/api/decisions', { ...payload, evidenceLedger: [{ ...evidence, sourceVersion: 'obsolete' }] }), 409);
});

async function login(url, password) {
  const response = await post(url, '/api/login', { password });
  await json(response);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  return cookie.split(';')[0];
}

test('password authentication protects workspace data and logout revokes the session', async t => {
  const password = 'synthetic-password-for-tests';
  const { url } = await fixture(t, { password });
  assert.match(await (await fetch(url + '/')).text(), /Workspace password/);
  await json(await fetch(url + '/api/decisions'), 401);
  await json(await post(url, '/api/login', { password: 'incorrect' }), 401);
  const cookie = await login(url, password);
  const status = await json(await fetch(url + '/api/status', { headers: { cookie } }));
  assert.equal(status.authentication, 'password');
  assert.equal(status.persistence, 'disk');
  const loggedOut = await post(url, '/api/logout', {}, cookie);
  await json(loggedOut);
  assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0/);
  await json(await fetch(url + '/api/data/snapshot', { headers: { cookie } }), 401);
});

test('Live HTTP sessions belong to their creating cookie and logout hangs up owned sessions', async t => {
  const password = 'synthetic-password-for-tests', calls = [];
  let nextId = 0;
  const { url } = await fixture(t, { password, apiKey: 'TEST_ONLY', fetchImpl: async (endpoint, init) => {
    calls.push(endpoint);
    if (endpoint.endsWith('/hangup')) return new Response(null, { status: 200 });
    if (endpoint.endsWith('/live/sessions')) return Response.json({ session: { id: `owned_${++nextId}` }, transport: { type: 'webrtc', sdp } });
    assert.equal(endpoint, 'https://api.openai.com/v1/responses');
    const input = JSON.parse(init.body).input;
    const evidence = input.filter(item => item.type === 'function_call_output').flatMap(item => JSON.parse(item.output).items || []);
    if (!evidence.length) return Response.json({ status: 'completed', output: [{ type: 'function_call', call_id: 'owned_metric', name: 'inspect_metrics', arguments: JSON.stringify({ metricIds: ['P01'], scope: { function: 'all', region: 'all', period: 'quarter' } }) }] });
    const metric = evidence.find(item => item.response?.action.metricId === 'P01');
    assert.ok(metric, 'the delegated analyst must retrieve governed metric evidence');
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ headline: 'Headcount evidence', summary: 'The active source provides the headcount baseline.', sections: [{ kind: 'finding', title: 'Headcount baseline', text: 'The headcount baseline is calculated from the active synthetic source.', evidenceRefs: [metric.refId] }], unknowns: [], followups: [], panels: [{ evidenceRef: metric.refId, title: 'Headcount', why: 'Inspect the governed baseline.' }] }) }] }] });
  } });
  const first = await login(url, password), second = await login(url, password);
  const created = await json(await post(url, '/api/live/session', { sdp }, first), 201);
  const sessionId = created.session.id;
  await json(await post(url, '/api/live/delegate', { sessionId, delegationId: 'd1', question: 'Explain P01' }, second), 404);
  await json(await post(url, '/api/live/close', { sessionId }, second), 404);
  assert.equal(calls.length, 1, 'denied ownership requests must not contact an upstream');
  const result = await json(await post(url, '/api/live/delegate', { sessionId, delegationId: 'd1', question: 'Explain P01' }, first));
  assert.equal(result.sessionId, sessionId);
  assert.equal(result.response.action.metricId, 'P01');
  await json(await post(url, '/api/live/delegate', { sessionId, delegationId: 'd1', question: 'Explain P01' }, first), 409);
  await json(await post(url, '/api/logout', {}, first));
  assert.ok(calls.includes(`https://api.openai.com/v1/live/sessions/${sessionId}/hangup`));
  const status = await json(await fetch(url + '/api/status', { headers: { cookie: second } }));
  assert.equal(status.live.activeSessions, 0);
});

test('awaiting server cleanup waits for a pending Live hangup', async t => {
  let releaseHangup, markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const hangup = new Promise(resolve => { releaseHangup = resolve; });
  const f = await fixture(t, { apiKey: 'TEST_ONLY', fetchImpl: async endpoint => {
    if (endpoint.endsWith('/hangup')) { markStarted(); await hangup; return new Response(null, { status: 200 }); }
    return Response.json({ session: { id: 'shutdown_session' }, transport: { type: 'webrtc', sdp } });
  } });
  await json(await post(f.url, '/api/live/session', { sdp }), 201);
  let finished = false;
  const closing = f.close(f.server).then(() => { finished = true; });
  try {
    await started;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false, 'shutdown cannot complete before upstream hangup settles');
  } finally { releaseHangup(); }
  await closing;
  assert.equal(finished, true);
});
