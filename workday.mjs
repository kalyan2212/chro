import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as waitForFileRelease } from 'node:timers/promises';
import { prepareSourceChanges, applySourceChanges, sourceError } from './source-edits.mjs';

// A synthetic custom-report adapter. These names and response envelopes are an
// illustrative RaaS-shaped contract, not assertions about Workday's public API.
export const REPORTS = Object.freeze([
  'CoreHCM', 'Talent', 'Payroll', 'HRServiceSupplement',
  'FinanceSupplement', 'ListeningSupplement', 'TalentCohorts'
]);
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const key = row => JSON.stringify([row.month, row.function, row.region]);
const cohortKey = row => JSON.stringify([row.function, row.region]);
const TALENT_STOCK = new Set(['successionPriorityRoles', 'successionReadyNow', 'criticalCapabilityRequired', 'criticalCapabilityReady']);
const TALENT_FLOW = new Set(['learningAssigned', 'learningCompleted', 'rampUpAssigned', 'rampUpCompleted', 'goalsEligible', 'goalsSubmitted', 'trainingDemands', 'projectsConverted']);
const PAYROLL_STOCK = new Set(['annualCostRunRate', 'costBreakdown', 'loadedPayByLevel', 'annualOTE']);
const FINANCE_STOCK = new Set(['annualBudgetRunRate', 'annualRevenueRunRate']);
const LISTENING_STOCK = new Set(['surveyInvited', 'surveyRespondents', 'surveyFavorable', 'pulseScoreTotal']);
const LISTENING_FLOW = new Set(['absenceDays', 'scheduledDays']);
const FINANCE_FLOW = new Set(['rewardsUSD']);
const partition = (object, predicate) => Object.fromEntries(Object.entries(object).filter(([name]) => predicate(name)));

function sourceRows(baseline, batch, name) {
  const cells = clone(baseline.cells);
  if (batch === 'correction' || batch === 'invalid') {
    const target = cells.find(row => row.month === baseline.months.at(-1) && row.function === 'Engineering' && row.region === 'EMEA');
    if (!target) throw new Error('Missing correction target');
    target.flow.goalsSubmitted = batch === 'invalid'
      ? target.flow.goalsEligible + 1 : Math.min(target.flow.goalsEligible, target.flow.goalsSubmitted + 17);
  }
  if (name === 'TalentCohorts') return clone(baseline.cohorts);
  return cells.map(cell => {
    const id = { month: cell.month, function: cell.function, region: cell.region };
    switch (name) {
      case 'CoreHCM': return { ...id,
        stock: partition(cell.stock, field => !TALENT_STOCK.has(field) && !PAYROLL_STOCK.has(field) && !FINANCE_STOCK.has(field) && !LISTENING_STOCK.has(field)),
        flow: partition(cell.flow, field => !TALENT_FLOW.has(field) && !FINANCE_FLOW.has(field) && !LISTENING_FLOW.has(field)) };
      case 'Talent': return { ...id, stock: partition(cell.stock, field => TALENT_STOCK.has(field)), flow: partition(cell.flow, field => TALENT_FLOW.has(field)) };
      case 'Payroll': return { ...id, stock: partition(cell.stock, field => PAYROLL_STOCK.has(field)) };
      case 'HRServiceSupplement': return { ...id, service: cell.service };
      case 'FinanceSupplement': return { ...id, stock: partition(cell.stock, field => FINANCE_STOCK.has(field)), flow: partition(cell.flow, field => FINANCE_FLOW.has(field)) };
      case 'ListeningSupplement': return { ...id, stock: partition(cell.stock, field => LISTENING_STOCK.has(field)), flow: partition(cell.flow, field => LISTENING_FLOW.has(field)) };
      default: throw new Error(`Unknown report: ${name}`);
    }
  });
}

function assertNumberTree(node, location) {
  if (typeof node === 'number') {
    if (!Number.isFinite(node) || node < 0) throw new Error(`Invalid nonnegative numeric value at ${location}`);
  } else if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) assertNumberTree(v, `${location}.${k}`);
  } else throw new Error(`Invalid aggregate at ${location}`);
}
function sum(object) { return Object.values(object).reduce((n, v) => n + v, 0); }
function between(n, upper, field) {
  if (!Number.isFinite(n) || n < 0 || n > upper) throw new Error(`Invalid numerator ${field}`);
}
function same(a, b, field) { if (a !== b) throw new Error(`Reconciliation failed: ${field}: ${a} != ${b}`); }
function moneySum(object) { return Object.values(object).reduce((total, value) => total + Math.round(value * 100), 0); }

function validate(dataset, baseline) {
  const { cells, cohorts, functions, regions, months } = dataset;
  const expected = functions.length * regions.length * months.length;
  if (cells.length !== expected || cohorts.length !== functions.length * regions.length) throw new Error('Missing monthly cells or cohorts');
  const seen = new Set(), seenCohorts = new Set();
  const byKey = new Map();
  for (const row of cells) {
    const id = key(row);
    if (!months.includes(row.month) || !functions.includes(row.function) || !regions.includes(row.region) || seen.has(id)) throw new Error('Duplicate or unknown monthly dimension key');
    seen.add(id); byKey.set(id, row);
    for (const part of ['stock', 'flow', 'service']) assertNumberTree(row[part], `${id}.${part}`);
    const { stock: s, flow: f, service: q } = row;
    same(f.beginningHeadcount + f.hires - f.voluntaryExits - f.involuntaryExits, s.headcount, `${id} headcount`);
    same(s.fte, s.headcount, `${id} FTE`);
    same(Math.round(s.annualCostRunRate * 100), moneySum(s.costBreakdown), `${id} cost components`);
    same(Math.round(s.costBreakdown.employeeLoaded * 100), moneySum(s.loadedPayByLevel), `${id} employee pay-level allocation`);
    same(q.beginningBacklog + q.inflow - q.resolved, q.backlog, `${id} service queue`);
    same(q.resolution.closed, q.resolved, `${id} closed cases`);
    same(f.externalHires, f.hires, `${id} external hires`);
    same(f.filledRoles, f.externalHires + f.internalHires, `${id} filled roles`);
    same(f.goalsEligible, s.headcount, `${id} eligible goals`);
    for (const [n, d, label] of [[f.goalsSubmitted, f.goalsEligible, 'goalsSubmitted'], [f.learningCompleted, f.learningAssigned, 'learningCompleted'], [f.rampUpCompleted, f.rampUpAssigned, 'rampUpCompleted'], [s.surveyRespondents, s.surveyInvited, 'surveyRespondents'], [s.surveyFavorable, s.surveyRespondents, 'surveyFavorable'], [q.withinSLA, q.resolved, 'withinSLA'], [q.csat.responses, q.resolved, 'CSAT responses']]) between(n, d, `${id}.${label}`);
    same(sum(s.employeeTypes), s.headcount, `${id} employee types`);
    same(sum(s.jobLevels), s.headcount, `${id} job levels`);
    same(sum(q.openByPriority), q.backlog, `${id} open priorities`);
    same(sum(q.csat.distribution), q.csat.responses, `${id} CSAT distribution`);
  }
  for (const month of months) for (const fn of functions) for (const region of regions) {
    const row = byKey.get(JSON.stringify([month, fn, region]));
    if (!row) throw new Error('Missing month/function/region cell');
    const previousMonth = months[months.indexOf(month) - 1];
    if (previousMonth) {
      const previous = byKey.get(JSON.stringify([previousMonth, fn, region]));
      same(row.flow.beginningHeadcount, previous.stock.headcount, 'headcount continuity');
      same(row.service.beginningBacklog, previous.service.backlog, 'service continuity');
    }
  }
  for (const row of cohorts) {
    const id = cohortKey(row);
    if (!functions.includes(row.function) || !regions.includes(row.region) || seenCohorts.has(id)) throw new Error('Duplicate or unknown cohort key');
    seenCohorts.add(id);
    assertNumberTree(row.current, `${id}.current`); assertNumberTree(row.prior, `${id}.prior`);
    same(row.current.delayed + row.current.onTime, row.current.hires, `${id} cohort partition`);
    same(row.current.delayedFirstYearExits + row.current.onTimeFirstYearExits, row.current.firstYearExits, `${id} cohort exits`);
    between(row.current.delayedFirstYearExits, row.current.delayed, `${id} delayed exits`);
    between(row.current.onTimeFirstYearExits, row.current.onTime, `${id} on-time exits`);
    between(row.prior.firstYearExits, row.prior.hires, `${id} prior exits`);
  }
  if (hash(cohorts) !== hash(baseline.cohorts)) throw new Error('Mature cohort history unexpectedly changed');
  return { expectedCells: expected, cells: seen.size, cohorts: seenCohorts.size,
    months: months.length, functions: functions.length, regions: regions.length, complete: true };
}

function assemble(reports, baseline) {
  const expected = baseline.functions.length * baseline.regions.length * baseline.months.length;
  const maps = new Map();
  for (const name of REPORTS) {
    const rows = reports.get(name);
    if (!Array.isArray(rows) || rows.length !== (name === 'TalentCohorts' ? baseline.cohorts.length : expected)) throw new Error(`Incomplete report: ${name}`);
    const map = new Map();
    for (const row of rows) {
      const id = name === 'TalentCohorts' ? cohortKey(row) : key(row);
      if (map.has(id)) throw new Error(`Duplicate report row in ${name}`);
      map.set(id, row);
    }
    maps.set(name, map);
  }
  const cells = baseline.months.flatMap(month => baseline.functions.flatMap(fn => baseline.regions.map(region => {
    const id = JSON.stringify([month, fn, region]);
    const parts = REPORTS.slice(0, -1).map(name => {
      const row = maps.get(name).get(id);
      if (!row) throw new Error(`Missing ${name} row for ${id}`);
      return row;
    });
    const result = { month, function: fn, region, stock: {}, flow: {}, service: {} };
    for (const part of parts) for (const field of ['stock', 'flow', 'service']) {
      for (const [name, value] of Object.entries(part[field] ?? {})) {
        if (Object.hasOwn(result[field], name)) throw new Error(`Overlapping ${field}.${name} for ${id}`);
        result[field][name] = value;
      }
    }
    return result;
  })));
  const cohorts = baseline.functions.flatMap(fn => baseline.regions.map(region => {
    const row = maps.get('TalentCohorts').get(JSON.stringify([fn, region]));
    if (!row) throw new Error('Missing mature cohort');
    return row;
  }));
  const dataset = { ...clone(baseline), cells, cohorts };
  // Catch dropped fields and unanticipated schema changes, preserving source completeness.
  const expectedFields = (row, field) => Object.keys(row[field]).sort().join('|');
  for (let i = 0; i < cells.length; i++) for (const field of ['stock', 'flow', 'service']) {
    if (expectedFields(cells[i], field) !== expectedFields(baseline.cells[i], field)) throw new Error(`Missing ${field} fields in reconstructed report`);
  }
  return dataset;
}

export function createWorkday({ baseline, storageDir, fetchReport, objectStore } = {}) {
  if (!baseline || !Array.isArray(baseline.cells) || !Array.isArray(baseline.cohorts)) throw new Error('A complete synthetic baseline is required');
  if (!objectStore && (!storageDir || typeof storageDir !== 'string')) throw new Error('storageDir is required');
  const original = clone(baseline), file = join(storageDir || '.', 'workday-synthetic-state.json');
  let state, generation="0", queue = Promise.resolve();
  async function persist(next, expected=generation) {
    if(objectStore){generation=await objectStore.write("workday-synthetic-state.json",next,expected);state=next;return;}
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
      for (let attempt = 0; ; attempt++) {
        try { await rename(temporary, file); break; }
        catch (error) {
          // Windows scanners can briefly hold the destination after a completed
          // read. Keep the same atomic replacement and ownership while retrying;
          // never remove the committed source or publish partial JSON.
          if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
          await waitForFileRelease(10 * 2 ** attempt);
        }
      }
    }
    catch (error) { await unlink(temporary).catch(() => {}); throw error; }
    state = next;
  }
  function ensureInit() { if (!state) throw new Error('Call init() before using the connector'); }
  async function init() {
    if (state) return status();
    if(!objectStore)await mkdir(storageDir, { recursive: true });
    let stored;
    try { if(objectStore){const current=await objectStore.read('workday-synthetic-state.json');stored=current.data;generation=current.generation;}else stored = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot load synthetic Workday state: ${error.message}`);
    }
    if (stored) {
      if (stored.schema !== 1 || !stored.snapshot || !Array.isArray(stored.history) || !stored.version || stored.version !== hash({ sourceRevision: stored.sourceRevision, cells: stored.snapshot.cells, cohorts: stored.snapshot.cohorts })) throw new Error('Corrupt or incompatible synthetic Workday state');
      validate(stored.snapshot, original);
      state = stored;
    } else {
      let release;
      if (!objectStore) {
        release = await acquireLocalLock();
        // Another process may have completed initialization or a confirmed edit
        // since our first read. Re-read under ownership; never publish a stale
        // baseline over its now-existing snapshot or audit.
        try {
          let existing;
          try { existing = JSON.parse(await readFile(file, 'utf8')); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (existing) {
            if (existing.schema !== 1 || !existing.snapshot || !Array.isArray(existing.history) || existing.version !== hash({ sourceRevision: existing.sourceRevision, cells: existing.snapshot.cells, cohorts: existing.snapshot.cohorts })) throw new Error('Corrupt or incompatible synthetic Workday state');
            validate(existing.snapshot, original); state = existing;
            await release(); return status();
          }
        } catch (error) { await release(); throw error; }
      }
      try {
      const snapshot = clone(original), coverage = validate(snapshot, original);
      const sourceRevision = 'synthetic:baseline:v1';
      const version = hash({ sourceRevision, cells: snapshot.cells, cohorts: snapshot.cohorts });
      snapshot.sourceVersion = version;
      try { await persist({ schema: 1, sourceRevision, version, snapshot, coverage, lastAttempt: null, lastSuccess: null, history: [] }); }
      catch(error){if(!objectStore||error.status!==409)throw error;await loadCurrent();}
      } finally { if (release) await release(); }
    }
    return status();
  }
  async function loadCurrent(){
    const current=objectStore ? await objectStore.read('workday-synthetic-state.json') : { data: JSON.parse(await readFile(file, 'utf8')), generation };
    const saved=current.data;
    if(!saved||saved.schema!==1||!saved.snapshot||!Array.isArray(saved.history)||saved.version!==hash({sourceRevision:saved.sourceRevision,cells:saved.snapshot.cells,cohorts:saved.snapshot.cohorts}))throw Error('Cloud synthetic source is missing or invalid. Restore its previous object version.');
    validate(saved.snapshot,original);state=saved;generation=current.generation;
  }
  function refresh(){
    // A refresh also mutates in-memory state/generation, so it must join the
    // operation queue rather than merely wait for an earlier queue snapshot.
    const next = queue.then(() => loadCurrent()); queue = next.catch(() => {}); return next;
  }
  function snapshot() { ensureInit(); return clone(state.snapshot); }
  function status() {
    ensureInit();
    return clone({ synthetic: true, connected: false, system: 'Synthetic custom Workday-style reports plus separately labeled supplements',
      sourceVersion: state.version, sourceRevision: state.sourceRevision, lastAttempt: state.lastAttempt,
      lastSuccess: state.lastSuccess, coverage: state.coverage, history: state.history,
      sourceEdits: { activeCount: (state.activeEditIds || []).length, latestUndoableEditId: state.activeEditIds?.at(-1) || null,
        syncBlocked: !!state.activeEditIds?.length } });
  }
  const publicEntry = entry => {
    const { owner, ...safe } = entry;
    // Internal pay-level allocation rows are needed for exact persistence/undo,
    // but revealing them in proposals/history would bypass small-group displays.
    if (safe.changes) safe.changes = safe.changes.filter(change => change.internal !== true);
    return clone(safe);
  };
  function editHistory() {
    ensureInit();
    return { sourceVersion: state.version, edits: (state.sourceEditHistory || []).slice(-100).map(publicEntry),
      proposals: (state.sourceEditProposals || []).filter(item => item.status === 'proposed' && item.sourceVersion === state.version).map(publicEntry),
      latestUndoableEditId: state.activeEditIds?.at(-1) || null, activeCount: (state.activeEditIds || []).length };
  }
  function sourceVersionGuard(expectedSourceVersion) {
    if (typeof expectedSourceVersion !== 'string' || expectedSourceVersion !== state.version)
      throw sourceError('The source changed. Refresh the source data and create or confirm a fresh proposal.', 409);
  }
  function editOwner(owner = 'local') {
    if (typeof owner !== 'string' || !owner.length || owner.length > 128) throw sourceError('A valid source edit owner is required.', 403);
    return owner;
  }
  function checkOwner(entry, owner) {
    if (entry.owner !== editOwner(owner)) throw sourceError('This source proposal belongs to another workspace session.', 403);
  }
  function checkedCoverage(candidate) {
    try { return validate(candidate, original); }
    catch (error) { throw sourceError(`Source change rejected: ${error.message}`); }
  }
  async function acquireLocalLock() {
    const lock = `${file}.lock`, token = randomUUID(), marker = `owner-${process.pid}-${token}`;
    const staging = `${lock}.${process.pid}.${token}.tmp`;
    const busy = () => sourceError('Another local source operation is in progress. Refresh and retry.', 409);
    await mkdir(staging);
    try {
      await writeFile(join(staging, marker), '', { flag: 'wx', mode: 0o600 });
      // Rename publishes a nonempty directory atomically: there is no interval in
      // which a new lock exists without an identifiable owner, even after a crash.
      try { await rename(staging, lock); }
      catch (error) {
        let entries;
        try { entries = await readdir(lock); } catch { throw error; }
        const match = entries.length === 1 && entries[0].match(/^owner-([1-9]\d*)-([0-9a-f-]{36})$/);
        if (!match) throw sourceError('The local source lock has no valid owner. Verify that no source write is running before repairing this lock.', 409);
        const pid = Number(match[1]); let alive = true;
        try { process.kill(pid, 0); }
        catch (probe) { if (probe.code === 'ESRCH') alive = false; }
        if (alive) throw busy();
        // Only the contender that removes this exact dead-owner marker may clear
        // the directory. A competitor seeing ENOENT must stop, never delete a
        // newly acquired lock. rmdir also refuses a replacement nonempty lock.
        try { await unlink(join(lock, entries[0])); await rmdir(lock); }
        catch { throw busy(); }
        try { await rename(staging, lock); } catch { throw busy(); }
      }
      return async () => {
        try { await unlink(join(lock, marker)); } catch { return; }
        await rmdir(lock).catch(() => {});
      };
    } finally {
      await unlink(join(staging, marker)).catch(() => {});
      await rmdir(staging).catch(() => {});
    }
  }
  function serialize(action) {
    const next = queue.then(async () => {
      if (objectStore) return action();
      // One process already serializes with queue; the directory lock also keeps
      // two local app processes from overwriting each other's proposal/audit state.
      const release = await acquireLocalLock();
      try { return await action(); }
      finally { await release(); }
    });
    queue = next.catch(() => {}); return next;
  }
  function proposeEdit({ expectedSourceVersion, changes, reason = '', owner } = {}) {
    return serialize(async () => {
      ensureInit(); await loadCurrent(); sourceVersionGuard(expectedSourceVersion);
      const actor = editOwner(owner);
      if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 1000)
        throw sourceError('Explain why this source value is changing using 3–1,000 characters.');
      const prepared = prepareSourceChanges(state.snapshot, changes);
      checkedCoverage(prepared.candidate);
      const proposal = { id: randomUUID(), status: 'proposed', sourceVersion: state.version, reason: reason.trim(),
        changes: prepared.changes, ...(prepared.allocations.length ? { allocations: prepared.allocations } : {}), createdAt: new Date().toISOString(), owner: actor };
      const pending = (state.sourceEditProposals || []).filter(item => item.status === 'proposed' && item.sourceVersion === state.version);
      await persist({ ...state, sourceEditProposals: [...pending.slice(-99), proposal] }, generation);
      return publicEntry(proposal);
    });
  }
  function applyEdit({ proposalId, expectedSourceVersion, owner } = {}) {
    return serialize(async () => {
      ensureInit(); await loadCurrent(); sourceVersionGuard(expectedSourceVersion);
      const proposal = (state.sourceEditProposals || []).find(item => item.id === proposalId);
      if (!proposal || proposal.status !== 'proposed') throw sourceError('This source proposal is missing or has already been applied.', 409);
      checkOwner(proposal, owner);
      if (proposal.sourceVersion !== state.version) throw sourceError('This proposal uses an older source revision. Create a fresh proposal.', 409);
      if ((state.activeEditIds || []).length >= 100) throw sourceError('Undo existing source edits before applying more than 100 active changes.', 409);
      const candidate = applySourceChanges(state.snapshot, proposal.changes), coverage = checkedCoverage(candidate);
      const id = randomUUID(), sourceRevision = `synthetic:edit:${id}`;
      const version = hash({ sourceRevision, cells: candidate.cells, cohorts: candidate.cohorts });
      candidate.sourceVersion = version;
      const edit = { id, proposalId, kind: 'apply', reason: proposal.reason, changes: proposal.changes,
        ...(proposal.allocations?.length ? { allocations: proposal.allocations } : {}),
        beforeSourceVersion: state.version, sourceVersion: version, at: new Date().toISOString(), owner: proposal.owner };
      const outcome = { at: edit.at, batch: 'source-edit', result: 'applied', editId: id, sourceRevision, sourceVersion: version };
      await persist({ ...state, snapshot: candidate, coverage, version, sourceRevision,
        sourceEditProposals: (state.sourceEditProposals || []).map(item => item.id === proposal.id ? { ...item, status: 'applied', editId: id } : item),
        sourceEditHistory: [...(state.sourceEditHistory || []), edit], activeEditIds: [...(state.activeEditIds || []), id],
        history: [...state.history, outcome] }, generation);
      return { changed: true, edit: publicEntry(edit), status: status(), snapshot: snapshot() };
    });
  }
  function undoEdit({ editId, expectedSourceVersion, owner } = {}) {
    return serialize(async () => {
      ensureInit(); await loadCurrent(); sourceVersionGuard(expectedSourceVersion);
      if (!editId || state.activeEditIds?.at(-1) !== editId) throw sourceError('Only the latest active source edit can be undone.', 409);
      const applied = (state.sourceEditHistory || []).find(item => item.id === editId && item.kind === 'apply');
      if (!applied) throw sourceError('The source edit audit record is missing.', 409);
      checkOwner(applied, owner);
      const candidate = applySourceChanges(state.snapshot, applied.changes, true), coverage = checkedCoverage(candidate);
      const id = randomUUID(), sourceRevision = `synthetic:undo:${id}`;
      const version = hash({ sourceRevision, cells: candidate.cells, cohorts: candidate.cohorts });
      candidate.sourceVersion = version;
      const edit = { id, kind: 'undo', undoOf: editId, proposalId: applied.proposalId, reason: `Undo source edit ${editId}`,
        changes: applied.changes.map(change => ({ ...change, before: change.after, after: change.before })),
        ...(applied.allocations?.length ? { allocations: applied.allocations.map(item => ({ ...item, beforeTotal: item.afterTotal, afterTotal: item.beforeTotal,
          description: 'Restores the exact employee pay-level allocation saved before the original edit. Raw pay-level values remain omitted.' })) } : {}),
        beforeSourceVersion: state.version, sourceVersion: version, at: new Date().toISOString(), owner: applied.owner };
      const outcome = { at: edit.at, batch: 'source-edit', result: 'undone', editId: id, undoOf: editId, sourceRevision, sourceVersion: version };
      await persist({ ...state, snapshot: candidate, coverage, version, sourceRevision,
        sourceEditHistory: [...(state.sourceEditHistory || []), edit], activeEditIds: state.activeEditIds.slice(0, -1),
        history: [...state.history, outcome] }, generation);
      return { changed: true, edit: publicEntry(edit), status: status(), snapshot: snapshot() };
    });
  }
  async function report({ name, cursor = '0', limit = 50, batch = 'baseline' } = {}) {
    if (!REPORTS.includes(name)) throw new Error('Unknown synthetic report');
    if (!['baseline', 'correction', 'invalid'].includes(batch)) throw new Error('Unknown synthetic batch');
    const start = Number(cursor);
    if (!Number.isSafeInteger(start) || start < 0 || String(start) !== String(cursor) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid report pagination');
    if (fetchReport) return fetchReport({ name, cursor: String(start), limit, batch });
    const rows = sourceRows(original, batch, name);
    if (start > rows.length) throw new Error('Cursor exceeds report length');
    const end = Math.min(rows.length, start + limit);
    return { report: name, batch, sourceRevision: `synthetic:${batch}:v1`, rows: rows.slice(start, end),
      nextCursor: end < rows.length ? String(end) : null, total: rows.length };
  }
  async function performSync(batch) {
    ensureInit();
    await loadCurrent();
    const baseState=state, expected=generation;
    if (baseState.activeEditIds?.length) throw sourceError('Demo sync is blocked while source edits are active. Undo those edits before replacing the corrected source.', 409);
    if (!['baseline', 'correction', 'invalid'].includes(batch)) throw new Error('Unknown synthetic batch');
    const attemptedAt = new Date().toISOString();
    try {
      const reports = new Map(); let revision;
      for (const name of REPORTS) {
        let cursor = '0', total, pages = 0;
        const seen = new Set(), rows = [];
        do {
          if (seen.has(cursor) || ++pages > 1000) throw new Error(`Pagination loop in ${name}`);
          seen.add(cursor);
          const page = await report({ name, batch, cursor, limit: 37 });
          if (!page || page.report !== name || page.batch !== batch || !Array.isArray(page.rows) || !page.rows.length || !Number.isSafeInteger(page.total)) throw new Error(`Malformed ${name} report page`);
          if (revision && revision !== page.sourceRevision) throw new Error('Mixed source revisions in sync');
          revision = page.sourceRevision;
          if (total != null && total !== page.total) throw new Error(`Report total changed in ${name}`);
          total = page.total;
          rows.push(...page.rows);
          if (rows.length > total) throw new Error(`Excess rows in ${name}`);
          cursor = page.nextCursor;
          if (cursor != null && (typeof cursor !== 'string' || !/^\d+$/.test(cursor))) throw new Error(`Invalid next cursor in ${name}`);
        } while (cursor != null);
        if (rows.length !== total) throw new Error(`Incomplete pages in ${name}`);
        reports.set(name, rows);
      }
      const candidate = assemble(reports, original), coverage = validate(candidate, original);
      const version = hash({ sourceRevision: revision, cells: candidate.cells, cohorts: candidate.cohorts });
      const changed = version !== baseState.version;
      const outcome = { at: attemptedAt, batch, sourceRevision: revision, sourceVersion: version,
        result: changed ? 'applied' : 'unchanged', reportRows: Object.fromEntries([...reports].map(([name, rows]) => [name, rows.length])) };
      candidate.sourceVersion = version;
      await persist({ ...baseState, snapshot: changed ? candidate : baseState.snapshot,
        version, sourceRevision: revision, coverage, lastAttempt: outcome, lastSuccess: outcome,
        history: [...baseState.history, outcome] }, expected);
      return { changed, status: status(), snapshot: snapshot() };
    } catch (error) {
      if(error.status===409)throw error;
      const failure = { at: attemptedAt, batch, result: 'rejected', error: error.message };
      await persist({ ...baseState, lastAttempt: failure, history: [...baseState.history, failure] }, expected);
      throw error;
    }
  }
  function sync({ batch = 'baseline' } = {}) {
    return serialize(() => performSync(batch));
  }
  return { init, refresh, snapshot, status, sync, report, proposeEdit, applyEdit, undoEdit, editHistory };
}
