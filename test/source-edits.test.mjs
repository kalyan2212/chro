import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile, unlink, rmdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createWorkday } from '../workday.mjs';
import { sourceCatalog, inspectSourceData } from '../source-edits.mjs';
import { descriptor, hydrateDataset, exportDataset } from '../engine.mjs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(html.match(/<script id="wi-source-data-js">([\s\S]*?)<\/script>/)[1], sandbox);
const baseline = JSON.parse(JSON.stringify(sandbox.window.WI_DATA));
const scope = { month: '2026-09', function: 'Engineering', region: 'EMEA' };
const field = 'stock.costBreakdown.contractors';
const cell = snapshot => snapshot.cells.find(row => row.month === scope.month && row.function === scope.function && row.region === scope.region);
const change = (value, operation = 'add', extra = {}) => ({ ...scope, path: field, operation, value, ...extra });
const owner = 'owner-a';
async function fixture(t) {
  const storageDir = await mkdtemp(join(tmpdir(), 'chro-source-edit-'));
  t.after(() => rm(storageDir, { recursive: true, force: true }));
  const workday = createWorkday({ baseline, storageDir }); await workday.init();
  return { workday, storageDir };
}
async function proposal(workday, changes = [change(12500)], extra = {}) {
  return workday.proposeEdit({ expectedSourceVersion: workday.status().sourceVersion, changes, reason: 'Correction verified against source records', owner, ...extra });
}
async function apply(workday, proposed) {
  return workday.applyEdit({ proposalId: proposed.id, expectedSourceVersion: proposed.sourceVersion, owner });
}

test('catalogue and bounded source previews expose only curated aggregates across all cells', async t => {
  const { workday } = await fixture(t), snapshot = workday.snapshot(), catalogue = sourceCatalog(snapshot);
  assert.deepEqual(catalogue.categories.map(item => item.id), ['cost', 'workforce', 'hiring', 'talent', 'listening', 'service']);
  assert.ok(catalogue.fields.some(item => item.path === field && item.editable));
  assert.ok(!catalogue.fields.some(item => /gender|diversity|race|cohort|tenure|persona|employeeRelations/i.test(item.path)));
  const inspected = inspectSourceData(snapshot, { month: scope.month, category: 'cost' });
  assert.equal(inspected.rows.length, 160); assert.equal(inspected.truncated, false);
  assert.equal(new Set(inspected.rows.map(row => `${row.function}/${row.region}`)).size, 20);
  const exact = inspectSourceData(snapshot, { ...scope, category: 'cost' });
  assert.equal(exact.rows.find(row => row.path === field).value, cell(snapshot).stock.costBreakdown.contractors);
  assert.equal(exact.rows.find(row => row.path === 'stock.annualCostRunRate').editable, false);
  assert.equal(exact.rows.find(row => row.path === 'stock.costBreakdown.employeeLoaded').editable, true);
  assert.equal(exact.rows.find(row => row.path === 'stock.costBreakdown.employeeLoaded').requiresAllocation, true);
  assert.equal(exact.rows.find(row => row.path === 'stock.costBreakdown.employeeLoaded').allocationOptions[0].id, 'preserve_pay_level_proportions');
  assert.equal(catalogue.fields.find(row => row.path === 'flow.averageFte').editable, false);
  const broad = inspectSourceData(snapshot);
  assert.equal(broad.rows.length, 300); assert.equal(broad.truncated, true); assert.ok(broad.totalRows > 300);
  assert.throws(() => inspectSourceData(snapshot, { category: '__proto__' }), /category/);
  assert.throws(() => inspectSourceData(snapshot, { function: 'unknown' }), /function/);
  catalogue.fields[0].path = '__proto__';
  assert.notEqual(sourceCatalog(snapshot).fields[0].path, '__proto__');
});

test('contractor correction previews an exact derived total, persists, recalculates and undoes after restart', async t => {
  const { workday, storageDir } = await fixture(t), before = workday.snapshot();
  const proposed = await proposal(workday);
  assert.equal(proposed.status, 'proposed'); assert.equal(proposed.changes.length, 2);
  assert.deepEqual(workday.snapshot(), before, 'proposing must not mutate source data');
  assert.equal(proposed.changes[0].before, cell(before).stock.costBreakdown.contractors);
  assert.equal(proposed.changes[0].after, proposed.changes[0].before + 12500);
  assert.equal(proposed.changes[1].path, 'stock.annualCostRunRate'); assert.equal(proposed.changes[1].derived, true);
  assert.equal(proposed.changes[1].after - proposed.changes[1].before, 12500);
  assert.ok(!JSON.stringify(proposed).includes(owner), 'owner is internal');
  proposed.changes[0].after = 999;
  const restarted = createWorkday({ baseline, storageDir }); await restarted.init();
  const applied = await apply(restarted, proposed);
  assert.equal(cell(applied.snapshot).stock.costBreakdown.contractors, cell(before).stock.costBreakdown.contractors + 12500);
  assert.equal(cell(applied.snapshot).stock.annualCostRunRate, cell(before).stock.annualCostRunRate + 12500);
  assert.notEqual(applied.snapshot.sourceVersion, before.sourceVersion);
  assert.deepEqual(applied.snapshot.cohorts, before.cohorts);
  assert.ok(!JSON.stringify(restarted.editHistory()).includes(owner));
  assert.equal(restarted.editHistory().latestUndoableEditId, applied.edit.id);
  const secondRestart = createWorkday({ baseline, storageDir }); await secondRestart.init();
  assert.deepEqual(secondRestart.snapshot(), applied.snapshot);
  const undone = await secondRestart.undoEdit({ editId: applied.edit.id, expectedSourceVersion: applied.snapshot.sourceVersion, owner });
  assert.deepEqual(undone.snapshot.cells, before.cells); assert.deepEqual(undone.snapshot.cohorts, before.cohorts);
  assert.notEqual(undone.snapshot.sourceVersion, before.sourceVersion, 'undo is its own auditable revision');
  assert.equal(secondRestart.editHistory().edits.length, 2); assert.equal(undone.edit.undoOf, applied.edit.id);
  assert.equal(secondRestart.status().sourceEdits.syncBlocked, false);
});

test('proposal and apply enforce exact revisions, owner, id and no double application', async t => {
  const { workday } = await fixture(t), first = await proposal(workday), second = await proposal(workday, [change(50)]);
  await assert.rejects(workday.applyEdit({ proposalId: first.id, expectedSourceVersion: first.sourceVersion, owner: 'other' }), error => error.status === 403);
  await assert.rejects(workday.applyEdit({ proposalId: 'unknown', expectedSourceVersion: first.sourceVersion, owner }), error => error.status === 409);
  const applied = await apply(workday, first);
  await assert.rejects(apply(workday, first), error => error.status === 409);
  await assert.rejects(workday.applyEdit({ proposalId: second.id, expectedSourceVersion: applied.snapshot.sourceVersion, owner }), error => error.status === 409);
  await assert.rejects(workday.proposeEdit({ expectedSourceVersion: first.sourceVersion, changes: [change(1)], owner }), error => error.status === 409);
  await assert.rejects(workday.undoEdit({ editId: applied.edit.id, expectedSourceVersion: first.sourceVersion, owner }), error => error.status === 409);
  await assert.rejects(workday.undoEdit({ editId: applied.edit.id, expectedSourceVersion: applied.snapshot.sourceVersion, owner: 'other' }), error => error.status === 403);
});

test('only latest edit can be undone and corrected source cannot be silently replaced by demo sync', async t => {
  const { workday } = await fixture(t), before = workday.snapshot();
  const first = await apply(workday, await proposal(workday));
  const second = await apply(workday, await proposal(workday, [change(100)]));
  await assert.rejects(workday.undoEdit({ editId: first.edit.id, expectedSourceVersion: second.snapshot.sourceVersion, owner }), error => error.status === 409);
  await assert.rejects(workday.sync({ batch: 'correction' }), error => error.status === 409 && /blocked/.test(error.message));
  assert.deepEqual(workday.snapshot(), second.snapshot);
  const undoneSecond = await workday.undoEdit({ editId: second.edit.id, expectedSourceVersion: second.snapshot.sourceVersion, owner });
  assert.deepEqual(undoneSecond.snapshot.cells, first.snapshot.cells);
  await workday.undoEdit({ editId: first.edit.id, expectedSourceVersion: undoneSecond.snapshot.sourceVersion, owner });
  assert.deepEqual(workday.snapshot().cells, before.cells);
  assert.equal((await workday.sync({ batch: 'correction' })).changed, true);
});

test('set, add and scale arithmetic is server-owned and reconciles multiple cost fields once', async t => {
  const { workday } = await fixture(t), before = cell(workday.snapshot()).stock;
  const proposed = await proposal(workday, [change(1.125, 'scale'), change(100.25, 'set', { path: 'stock.costBreakdown.overtime' })]);
  assert.equal(proposed.changes.length, 3);
  assert.equal(proposed.changes[0].after, Math.round(before.costBreakdown.contractors * 1.125 * 100) / 100);
  const result = await apply(workday, proposed), stock = cell(result.snapshot).stock;
  assert.equal(stock.costBreakdown.overtime, 100.25);
  assert.equal(stock.annualCostRunRate, stock.costBreakdown.employeeLoaded + stock.costBreakdown.overtime + stock.costBreakdown.contractors);
});

test('hydrating a confirmed source edit recalculates scoped and company-wide cost evidence', async t => {
  const { workday } = await fixture(t), before = workday.snapshot();
  const metricScope = { function: scope.function, region: scope.region, period: scope.month };
  hydrateDataset(before);
  t.after(() => hydrateDataset(exportDataset()));
  const scopedBefore = descriptor('E02', metricScope).value;
  const companyBefore = descriptor('E02', { function: 'all', region: 'all', period: scope.month }).value;
  const result = await apply(workday, await proposal(workday));
  hydrateDataset(result.snapshot);
  assert.equal(descriptor('E02', metricScope).value, scopedBefore + 12500);
  assert.equal(descriptor('E02', { function: 'all', region: 'all', period: scope.month }).value, companyBefore + 12500);
  const undo = await workday.undoEdit({ editId: result.edit.id, expectedSourceVersion: result.snapshot.sourceVersion, owner });
  hydrateDataset(undo.snapshot);
  assert.equal(descriptor('E02', metricScope).value, scopedBefore);
});

test('unknown/prototype/protected paths, ambiguous cells, non-finite values and no-op proposals fail closed', async t => {
  const { workday } = await fixture(t), before = workday.snapshot();
  const bad = [
    change(100, 'set', { path: '__proto__.polluted' }), change(100, 'set', { path: 'stock.constructor.x' }),
    change(100, 'set', { path: 'stock.gender.women' }), change(100, 'set', { path: 'stock.annualCostRunRate' }),
    change(100, 'set', { function: 'all' }), change(100, 'set', { month: undefined }),
    change(NaN), change(Infinity), change(-1e20), change(-1, 'set'), change(2.123, 'set'),
    change(1.1, 'set', { path: 'stock.openRoles' }), change(1, 'eval'), change(0, 'add'),
    change(1, 'set', { arbitrary: true })
  ];
  for (const requested of bad) await assert.rejects(proposal(workday, [requested]), error => error.status === 400);
  await assert.rejects(proposal(workday, [change(1), change(2)]), /only once/);
  await assert.rejects(proposal(workday, Array.from({ length: 13 }, () => change(1))), /between 1 and 12/);
  assert.deepEqual(workday.snapshot(), before); assert.equal(workday.editHistory().proposals.length, 0);
  assert.equal({}.polluted, undefined);
});

test('existing reconciliation still rejects invalid source numerators before creating a proposal', async t => {
  const { workday } = await fixture(t), before = workday.snapshot(), eligible = cell(before).flow.goalsEligible;
  await assert.rejects(proposal(workday, [change(eligible + 1, 'set', { path: 'flow.goalsSubmitted' })]), /goalsSubmitted/);
  await assert.rejects(proposal(workday, [change(cell(before).service.knowledgeViews + 1, 'set', { path: 'service.knowledgeHelpful' })]), /Helpful/);
  await assert.rejects(proposal(workday, [change(1, 'add', { path: 'service.withinSLA' })]), /within SLA/);
  assert.deepEqual(workday.snapshot(), before); assert.equal(workday.editHistory().proposals.length, 0);
});

test('editable funnel, survey and service aggregates retain their source population relationships', async t => {
  const { workday } = await fixture(t), before = workday.snapshot(), row = cell(before);
  const invalid = [
    ['flow.screened', row.flow.applications + 1, /Screened candidates/],
    ['flow.applications', row.flow.screened - 1, /Screened candidates/],
    ['flow.interviewed', row.flow.screened + 1, /Interviewed/],
    ['flow.offers', row.flow.interviewed + 1, /Offers \/ interviewed/],
    ['flow.accepted', row.flow.offers + 1, /Accepted offers/],
    ['flow.regrettableExits', row.flow.voluntaryExits + 1, /Regrettable/],
    ['stock.surveyInvited', row.stock.headcount + 1, /Survey invitations/],
    ['service.virtualAgentResolved', row.service.virtualAgentResolved + 1, /resolutions plus human handoffs/],
    ['flow.averageFte', row.flow.averageFte + 1, /Derived from beginning/],
    ['stock.managers', row.stock.headcount + 1, /distribution totals/],
    ['stock.costBreakdown.employeeLoaded', row.stock.costBreakdown.employeeLoaded + 1, /explicit allocation choice/]
  ];
  for (const [path, value, pattern] of invalid) await assert.rejects(proposal(workday, [change(value, 'set', { path })]), pattern);
  assert.deepEqual(workday.snapshot(), before); assert.equal(workday.editHistory().proposals.length, 0);
  const balanced = await proposal(workday, [
    change(1, 'add', { path: 'service.virtualAgentResolved' }),
    change(-1, 'add', { path: 'service.humanHandoffs' }),
    change(1, 'add', { path: 'service.withinSLA' }),
    change(-1, 'add', { path: 'service.breachedResolved' })
  ]);
  const applied = await apply(workday, balanced), q = cell(applied.snapshot).service;
  assert.equal(q.virtualAgentResolved + q.humanHandoffs, q.virtualAgentSessions);
  assert.equal(q.withinSLA + q.breachedResolved, q.resolved);
  const undone = await workday.undoEdit({ editId: applied.edit.id, expectedSourceVersion: applied.snapshot.sourceVersion, owner });
  assert.deepEqual(undone.snapshot.cells, before.cells);
});

test('employee cost requires explicit reviewed allocation and keeps public proposals free of raw pay-level amounts', async t => {
  const { workday, storageDir } = await fixture(t), before = workday.snapshot(), initial = cell(before).stock;
  const employeeChange = change(initial.costBreakdown.employeeLoaded + 1234.57, 'set', {
    path: 'stock.costBreakdown.employeeLoaded', allocation: 'preserve_pay_level_proportions'
  });
  const proposed = await proposal(workday, [employeeChange], { reason: 'Reforecast' });
  assert.equal(proposed.reason, 'Reforecast'); assert.equal(proposed.changes.length, 2);
  assert.equal(proposed.changes[0].path, 'stock.costBreakdown.employeeLoaded');
  assert.equal(proposed.changes[0].allocation, 'preserve_pay_level_proportions');
  assert.equal(proposed.changes[1].path, 'stock.annualCostRunRate');
  assert.equal(proposed.allocations[0].beforeTotal, initial.costBreakdown.employeeLoaded);
  assert.equal(proposed.allocations[0].afterTotal, employeeChange.value);
  assert.equal(proposed.allocations[0].protectedBreakdownsOmitted, true);
  assert.ok(!JSON.stringify(proposed).includes('stock.loadedPayByLevel'));
  assert.deepEqual(workday.snapshot(), before, 'allocation review does not apply data');
  const persisted = JSON.parse(await readFile(join(storageDir, 'workday-synthetic-state.json'), 'utf8'));
  const internal = persisted.sourceEditProposals.find(item => item.id === proposed.id).changes.filter(item => item.internal);
  assert.equal(internal.length, 4); assert.ok(internal.every(item => item.derived && item.path.startsWith('stock.loadedPayByLevel.')));
  const restarted = createWorkday({ baseline, storageDir }); await restarted.init();
  const applied = await apply(restarted, proposed), actual = cell(applied.snapshot).stock;
  assert.equal(actual.costBreakdown.employeeLoaded, employeeChange.value);
  const cents = value => Math.round(value * 100);
  assert.equal(Object.values(actual.loadedPayByLevel).reduce((sum, value) => sum + cents(value), 0), cents(employeeChange.value));
  assert.equal(cents(actual.annualCostRunRate), Object.values(actual.costBreakdown).reduce((sum, value) => sum + cents(value), 0));
  for (const [level, value] of Object.entries(initial.loadedPayByLevel)) {
    const exactShare = cents(employeeChange.value) * value / initial.costBreakdown.employeeLoaded;
    assert.ok(Math.abs(cents(actual.loadedPayByLevel[level]) - exactShare) < 1, 'cent allocation is within one cent of each existing exact share');
  }
  assert.deepEqual(actual.jobLevels, initial.jobLevels); assert.deepEqual(actual.genderByLevel, initial.genderByLevel);
  assert.equal(actual.headcount, initial.headcount); assert.equal(actual.annualOTE, initial.annualOTE);
  assert.ok(!JSON.stringify(applied.edit).includes('stock.loadedPayByLevel'));
  assert.ok(!JSON.stringify(restarted.editHistory()).includes('stock.loadedPayByLevel'));
  const undo = await restarted.undoEdit({ editId: applied.edit.id, expectedSourceVersion: applied.snapshot.sourceVersion, owner });
  assert.deepEqual(undo.snapshot.cells, before.cells);
  assert.equal(undo.edit.allocations[0].beforeTotal, employeeChange.value);
  assert.equal(undo.edit.allocations[0].afterTotal, initial.costBreakdown.employeeLoaded);
});

test('employee allocation rounds deterministically, handles zero target, and rejects nonexistent or unspecified shares', async t => {
  const { workday } = await fixture(t), before = workday.snapshot();
  const make = (value, extra = {}) => change(value, 'set', { path: 'stock.costBreakdown.employeeLoaded', allocation: 'preserve_pay_level_proportions', ...extra });
  const a = await proposal(workday, [make(.01)]), b = await proposal(workday, [make(.01)]);
  assert.deepEqual(a.changes, b.changes); assert.deepEqual(a.allocations, b.allocations);
  const oneCent = await apply(workday, a);
  assert.equal(Object.values(cell(oneCent.snapshot).stock.loadedPayByLevel).filter(value => value === .01).length, 1);
  const zero = await apply(workday, await proposal(workday, [make(0)]));
  assert.ok(Object.values(cell(zero.snapshot).stock.loadedPayByLevel).every(value => value === 0));
  await assert.rejects(proposal(workday, [make(1000)]), /shares are zero/);
  await workday.undoEdit({ editId: zero.edit.id, expectedSourceVersion: zero.snapshot.sourceVersion, owner });
  await workday.undoEdit({ editId: oneCent.edit.id, expectedSourceVersion: workday.status().sourceVersion, owner });
  assert.deepEqual(workday.snapshot().cells, before.cells);
  await assert.rejects(proposal(workday, [make(1000, { allocation: undefined })]), /explicit allocation choice/);
  await assert.rejects(proposal(workday, [make(1000, { allocation: 'invent_new_distribution' })]), /explicit allocation choice/);
  await assert.rejects(proposal(workday, [change(1000, 'set', { allocation: 'preserve_pay_level_proportions' })]), /only for employee/);
  await assert.rejects(proposal(workday, [make(1000, { path: 'stock.loadedPayByLevel.manager' })]), /not available/);
});

test('equal employee-cost shares use a stable cent tie-break and reconcile exactly', async t => {
  const storageDir = await mkdtemp(join(tmpdir(), 'chro-source-rounding-'));
  t.after(() => rm(storageDir, { recursive: true, force: true }));
  const equalShares = structuredClone(baseline), stock = cell(equalShares).stock;
  stock.loadedPayByLevel = { individual: 1, manager: 1, director: 1, executive: 1 };
  stock.costBreakdown.employeeLoaded = 4;
  stock.annualCostRunRate = Object.values(stock.costBreakdown).reduce((sum, value) => sum + value, 0);
  const workday = createWorkday({ baseline: equalShares, storageDir }); await workday.init();
  const proposed = await proposal(workday, [change(.02, 'set', { path: 'stock.costBreakdown.employeeLoaded', allocation: 'preserve_pay_level_proportions' })]);
  const applied = await apply(workday, proposed);
  assert.deepEqual(cell(applied.snapshot).stock.loadedPayByLevel, { individual: .01, manager: .01, director: 0, executive: 0 });
  assert.equal(cell(applied.snapshot).stock.costBreakdown.employeeLoaded, .02);
});

test('new proposals need a user rationale, while older stored proposals remain applicable', async t => {
  const { workday, storageDir } = await fixture(t);
  for (const reason of ['', '  ', ' x ', 'x'.repeat(1001), null]) await assert.rejects(proposal(workday, [change(1)], { reason }), /Explain why/);
  const proposed = await proposal(workday, [change(1)], { reason: '  Reforecast  ' });
  assert.equal(proposed.reason, 'Reforecast');
  const file = join(storageDir, 'workday-synthetic-state.json'), stored = JSON.parse(await readFile(file, 'utf8'));
  stored.sourceEditProposals.find(item => item.id === proposed.id).reason = '';
  await writeFile(file, JSON.stringify(stored));
  const restarted = createWorkday({ baseline, storageDir }); await restarted.init();
  const applied = await apply(restarted, proposed); assert.equal(applied.changed, true);
  assert.equal(applied.edit.reason, '', 'old persisted proposals are not retroactively invalidated');
});

test('independent local connectors cannot overwrite each other during an apply race', async t => {
  const { workday, storageDir } = await fixture(t), other = createWorkday({ baseline, storageDir }); await other.init();
  const proposed = await proposal(workday);
  const results = await Promise.allSettled([apply(workday, proposed), apply(other, proposed)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.status, 409);
  await workday.refresh(); await other.refresh();
  assert.deepEqual(workday.snapshot(), other.snapshot()); assert.equal(workday.editHistory().edits.length, 1);
});

test('a dead local lock owner is recovered after restart without changing unconfirmed source data', async t => {
  const { workday, storageDir } = await fixture(t), before = workday.snapshot();
  const exited = spawnSync(process.execPath, ['-e', '']);
  assert.equal(exited.status, 0); assert.ok(exited.pid > 0 && exited.pid !== process.pid);
  const lock = join(storageDir, 'workday-synthetic-state.json.lock');
  await mkdir(lock); await writeFile(join(lock, `owner-${exited.pid}-${randomUUID()}`), '');
  const restarted = createWorkday({ baseline, storageDir }); await restarted.init();
  const proposed = await proposal(restarted);
  assert.equal(proposed.status, 'proposed'); assert.deepEqual(restarted.snapshot(), before);
  assert.ok(!(await readdir(storageDir)).some(name => name.includes('.lock')), 'recovery and normal cleanup leave no lock or staging directories');
});

test('a live lock owner cannot be stolen and source state remains unchanged', async t => {
  const { workday, storageDir } = await fixture(t), before = workday.snapshot();
  const lock = join(storageDir, 'workday-synthetic-state.json.lock'), marker = `owner-${process.pid}-${randomUUID()}`;
  await mkdir(lock); await writeFile(join(lock, marker), '');
  await assert.rejects(proposal(workday), error => error.status === 409 && /in progress/.test(error.message));
  assert.deepEqual(await readdir(lock), [marker]); assert.deepEqual(workday.snapshot(), before);
  assert.equal((await readdir(storageDir)).filter(name => name.includes('.tmp')).length, 0);
});

test('first local initialization respects source write ownership instead of publishing a baseline over a writer', async t => {
  const storageDir = await mkdtemp(join(tmpdir(), 'chro-source-init-'));
  t.after(() => rm(storageDir, { recursive: true, force: true }));
  const file = join(storageDir, 'workday-synthetic-state.json'), lock = file + '.lock', marker = `owner-${process.pid}-${randomUUID()}`;
  await mkdir(lock); await writeFile(join(lock, marker), '');
  const workday = createWorkday({ baseline, storageDir });
  await assert.rejects(workday.init(), error => error.status === 409);
  await assert.rejects(readFile(file), error => error.code === 'ENOENT');
  await unlink(join(lock, marker)); await rmdir(lock);
  await workday.init(); assert.deepEqual(workday.snapshot().cells, baseline.cells);
});

test('local queue serializes racing applies so exactly one version wins', async t => {
  const { workday } = await fixture(t), first = await proposal(workday), second = await proposal(workday, [change(50)]);
  const results = await Promise.allSettled([apply(workday, first), apply(workday, second)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.status, 409);
  assert.equal(workday.editHistory().edits.length, 1);
});

test('cloud proposals and edits use generation guards without losing the winning audit', async () => {
  let data = null, generation = '0', rejectWrites = false;
  const objectStore = {
    async read() { return { data: structuredClone(data), generation }; },
    async write(name, next, expected) {
      if (rejectWrites || expected !== generation) throw Object.assign(new Error('Cloud revision conflict'), { status: 409 });
      data = structuredClone(next); generation = String(Number(generation) + 1); return generation;
    }
  };
  const a = createWorkday({ baseline, objectStore }), b = createWorkday({ baseline, objectStore });
  await Promise.all([a.init(), b.init()]);
  const proposed = await proposal(a);
  await b.refresh(); assert.equal(b.editHistory().proposals[0].id, proposed.id);
  const results = await Promise.allSettled([apply(a, proposed), apply(b, proposed)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.status, 409);
  await a.refresh(); await b.refresh(); assert.deepEqual(a.snapshot(), b.snapshot());
  const committed = a.snapshot(), audit = a.editHistory(); rejectWrites = true;
  await assert.rejects(a.undoEdit({ editId: audit.latestUndoableEditId, expectedSourceVersion: committed.sourceVersion, owner }), error => error.status === 409);
  assert.deepEqual(a.snapshot(), committed); assert.deepEqual(a.editHistory(), audit);
  rejectWrites = false;
  const undo = await b.undoEdit({ editId: audit.latestUndoableEditId, expectedSourceVersion: committed.sourceVersion, owner });
  assert.deepEqual(undo.snapshot.cells, baseline.cells);
});

test('a delayed source refresh cannot roll back in-memory state after a concurrent confirmed edit', async () => {
  let data = null, generation = '0', writes = 0, holdNextRead = false, releaseRead, readStarted;
  const started = new Promise(resolve => { readStarted = resolve; });
  const objectStore = {
    async read() {
      const captured = { data: structuredClone(data), generation };
      if (holdNextRead) { holdNextRead = false; readStarted(); await new Promise(resolve => { releaseRead = resolve; }); }
      return captured;
    },
    async write(name, next, expected) {
      if (expected !== generation) throw Object.assign(new Error('Cloud revision conflict'), { status: 409 });
      writes++; data = structuredClone(next); generation = String(Number(generation) + 1); return generation;
    }
  };
  const workday = createWorkday({ baseline, objectStore }); await workday.init(); const proposed = await proposal(workday);
  const priorWrites = writes; holdNextRead = true;
  const refreshing = workday.refresh(); await started;
  const applying = apply(workday, proposed);
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes, priorWrites, 'the edit must wait for the earlier in-flight refresh');
  } finally { releaseRead(); }
  await refreshing; const result = await applying;
  assert.equal(workday.snapshot().sourceVersion, result.snapshot.sourceVersion);
  assert.deepEqual(workday.snapshot(), data.snapshot);
  assert.equal(workday.editHistory().latestUndoableEditId, result.edit.id);
});
