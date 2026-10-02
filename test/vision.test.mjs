import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImage } from '../vision.mjs';
import { createServer } from '../server.mjs';
import { exportDataset } from '../engine.mjs';

const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpegHeader = Buffer.from([255, 216, 255]);
const image = (mime = 'image/png', size = 32) => {
  const bytes = Buffer.alloc(size); (mime === 'image/png' ? pngHeader : jpegHeader).copy(bytes);
  return { dataUrl: 'data:' + mime + ';base64,' + bytes.toString('base64'), name: 'Synthetic chart' };
};
const invalid = input => assert.throws(() => validateImage(input), error => error.status === 400 && !error.message.includes('data:'));

test('image validation accepts supported canonical encodings and returns only sanitized metadata', () => {
  assert.equal(validateImage(undefined), undefined); assert.equal(validateImage(null), undefined);
  for (const mime of ['image/png', 'image/jpeg']) {
    const input = image(mime), result = validateImage({ ...input, unexpected: 'DO-NOT-RETURN' });
    assert.equal(result.mimeType, mime); assert.equal(result.dataUrl, input.dataUrl); assert.equal(result.name, 'Synthetic chart');
    assert.deepEqual(Object.keys(result).sort(), ['dataUrl', 'mimeType', 'name']);
  }
  const result = validateImage({ ...image(), name: '<chart>\n\u0000' + 'x'.repeat(200) });
  assert.equal(result.name.length, 120); assert.ok(!/[\u0000-\u001f<>]/.test(result.name));
  assert.equal(validateImage({ dataUrl: image().dataUrl }).name, 'Attached chart');
});

test('image validation rejects external URLs, active image types, malformed base64 and MIME mismatches', () => {
  for (const value of ['', [], 3, {}, { dataUrl: 3 }, { dataUrl: 'https://example.invalid/chart.png' },
    { dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }, { dataUrl: 'data:image/gif;base64,R0lGODlh' },
    { dataUrl: image().dataUrl.replace('image/png', 'image/jpeg') },
    { dataUrl: image('image/jpeg').dataUrl.replace('image/jpeg', 'image/png') },
    { dataUrl: image().dataUrl + '\n' }, { dataUrl: image().dataUrl.replace(';base64,', ',') },
    { dataUrl: image().dataUrl.replace('base64,', 'base64,!') }, image('image/png', 15)
  ]) invalid(value);
  const canonical = image('image/png', 16).dataUrl;
  // Alter unused padding bits: Node decodes it, but canonical re-encoding differs.
  invalid({ dataUrl: canonical.slice(0, -3) + 'B==' });
});

test('attachment byte and encoded-length limits reject oversized payloads before provider use', () => {
  const boundary = image('image/png', 4_000_000);
  assert.equal(validateImage(boundary).mimeType, 'image/png');
  invalid(image('image/png', 4_000_001));
  invalid({ dataUrl: 'data:image/png;base64,' + 'A'.repeat(6_000_001) });
});

async function setup(t, options = {}) {
  const server = createServer({ apiKey: '', fetchImpl: () => { throw Error('External request is not allowed by this test'); }, ...options });
  await server.ready; await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await server.whenClosed(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, data, cookie) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) });
  return { base, post };
}

test('HTTP uploads retain separate delegate and close limits and do not bypass session ownership', async t => {
  const { base, post } = await setup(t);
  const uploaded = image('image/png', 80000);
  const answer = await post('/api/ask', { question: 'Interpret this chart.', image: uploaded });
  assert.equal(answer.status, 503); assert.match((await answer.json()).error, /configured Astra/);
  const delegate = await post('/api/live/delegate', { sessionId: 'not-owned', delegationId: 'synthetic-delegation', question: 'Interpret this chart.', image: uploaded });
  assert.equal(delegate.status, 404); assert.match((await delegate.json()).error, /session not found/);
  const close = await post('/api/live/close', { sessionId: 'not-owned', image: uploaded });
  assert.equal(close.status, 413);
  const tooLarge = await post('/api/live/delegate', { sessionId: 'not-owned', padding: 'x'.repeat(8_200_001) });
  assert.equal(tooLarge.status, 413);
  const audit = await (await fetch(base + '/api/audit')).json();
  assert.ok(!JSON.stringify(audit).includes('data:image'));
});

test('progress polling is owner-scoped process metadata and avoids cloud reads while data requests still refresh', async t => {
  const snapshot = { ...exportDataset(), sourceVersion: 'progress-snapshot' };
  let reads = 0, refreshes = 0, generation = 0, state = { schema: 1, decisions: [], investigations: [], audit: [] };
  const objectStore = {
    async read() { reads++; return { data: structuredClone(state), generation: String(generation) }; },
    async write(name, data, expected) { assert.equal(expected, String(generation)); state = structuredClone(data); return String(++generation); }
  };
  const workday = { async init() {}, async refresh() { refreshes++; }, snapshot: () => structuredClone(snapshot), status: () => ({ sourceVersion: snapshot.sourceVersion, history: [] }) };
  const password = 'synthetic-progress-test-password', { base, post } = await setup(t, { password, objectStore, workday });
  const signIn = async () => { const response = await post('/api/login', { password }); assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0]; };
  const first = await signIn(), second = await signIn();
  const asked = await post('/api/ask', { question: 'Explain P01', requestId: 'progress-test-001' }, first); assert.equal(asked.status, 200);
  const before = { reads, refreshes };
  const poll = await fetch(base + '/api/analysis/progress?id=progress-test-001', { headers: { cookie: first } });
  assert.equal(poll.status, 200); assert.deepEqual(await poll.json(), { events: [], done: true });
  assert.deepEqual({ reads, refreshes }, before);
  const other = await fetch(base + '/api/analysis/progress?id=progress-test-001', { headers: { cookie: second } }); assert.equal(other.status, 404);
  assert.equal((await fetch(base + '/api/analysis/progress?id=progress-test-001')).status, 401);
  assert.deepEqual({ reads, refreshes }, before);
  assert.equal((await fetch(base + '/api/status', { headers: { cookie: first } })).status, 200);
  assert.ok(reads > before.reads); assert.ok(refreshes > before.refreshes);
  const afterStatus = { reads, refreshes };
  assert.equal((await post('/api/analysis/progress', {}, first)).status, 404);
  assert.ok(reads > afterStatus.reads); assert.ok(refreshes > afterStatus.refreshes);
});
