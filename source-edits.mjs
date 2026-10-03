// Explicit aggregate source fields only. Protected subdivisions and cohort histories
// are intentionally absent: source inspection must not bypass display suppression.
const clone = value => JSON.parse(JSON.stringify(value));
export function sourceError(message, status = 400) {
  return Object.assign(new Error(message), { status, publicMessage: message });
}
const categories = [
  ['cost', 'Cost and funding'], ['workforce', 'Workforce'], ['hiring', 'Hiring'],
  ['talent', 'Talent and learning'], ['listening', 'Listening'], ['service', 'HR service']
].map(([id, label]) => Object.freeze({ id, label }));
const fields = [];
function add(category, unit, paths, editable = true, reason) {
  for (const [path, label] of paths) fields.push(Object.freeze({ path, label, category, unit, editable, ...(reason ? { reason } : {}) }));
}
add('cost', 'usd', [
  ['stock.costBreakdown.overtime', 'Overtime cost'],
  ['stock.costBreakdown.contractors', 'External contractor cost'],
  ['stock.annualBudgetRunRate', 'Annual workforce budget'],
  ['stock.annualRevenueRunRate', 'Annual revenue run-rate'],
  ['stock.annualOTE', 'Annual on-target earnings'], ['flow.rewardsUSD', 'Recognition rewards']
]);
add('cost', 'usd', [['stock.costBreakdown.employeeLoaded', 'Employee loaded cost']], false,
  'Requires a reconciled pay-level allocation through a complete source import. The editor will not invent a distribution across pay levels.');
add('cost', 'usd', [['stock.annualCostRunRate', 'Annual workforce cost']], false,
  'Calculated from the three cost components. Edit a component to reconcile this total.');
add('workforce', 'count', [
  ['stock.headcount', 'Headcount'], ['stock.fte', 'Full-time equivalent workforce'],
  ['flow.beginningHeadcount', 'Beginning headcount'], ['flow.hires', 'Hires'],
  ['flow.voluntaryExits', 'Voluntary exits'], ['flow.involuntaryExits', 'Involuntary exits']
], false, 'Linked workforce partitions and monthly continuity require a complete validated source import.');
add('workforce', 'count', [
  ['stock.contractors', 'Contractor headcount'],
  ['stock.openRoles', 'Open roles'], ['stock.hrStaff', 'HR staff'],
  ['flow.regrettableExits', 'Regrettable exits']
]);
add('workforce', 'count', [['stock.managers', 'Managers'], ['flow.promotions', 'Promotions']], false,
  'Reconciles to source distribution totals. Use a complete validated source import.');
add('workforce', 'fte', [['flow.averageFte', 'Average full-time equivalent workforce']], false,
  'Derived from beginning and ending workforce in this synthetic source. Change linked workforce values through a complete validated source import.');
add('workforce', 'days', [['flow.absenceDays', 'Absence days'], ['flow.scheduledDays', 'Scheduled days']]);
add('hiring', 'count', [
  ['flow.applications', 'Applications'], ['flow.screened', 'Screened candidates'],
  ['flow.interviewed', 'Interviewed candidates'], ['flow.offers', 'Offers'],
  ['flow.accepted', 'Accepted offers']
]);
add('hiring', 'count', [
  ['flow.externalHires', 'External hires'], ['flow.internalHires', 'Internal hires'], ['flow.filledRoles', 'Filled roles']
], false, 'Linked hires and workforce continuity require a complete validated source import.');
add('hiring', 'days', [['flow.fillDays', 'Total days to fill roles']]);
add('talent', 'count', [
  ['stock.successionPriorityRoles', 'Succession priority roles'], ['stock.successionReadyNow', 'Successors ready now'],
  ['stock.criticalCapabilityRequired', 'Critical capability requirements'], ['stock.criticalCapabilityReady', 'Critical capabilities ready'],
  ['flow.learningAssigned', 'Learning assignments'], ['flow.learningCompleted', 'Learning completions'],
  ['flow.rampUpAssigned', 'Ramp-up assignments'], ['flow.rampUpCompleted', 'Ramp-up completions'],
  ['flow.goalsSubmitted', 'Goals submitted'], ['flow.trainingDemands', 'Training demands'],
  ['flow.projectsConverted', 'Projects converted'], ['flow.recognitionEvents', 'Recognition events']
]);
add('talent', 'count', [['flow.goalsEligible', 'Employees eligible for goals']], false, 'Reconciles to workforce headcount.');
add('listening', 'count', [
  ['stock.surveyInvited', 'Survey invitations'], ['stock.surveyRespondents', 'Survey respondents'], ['stock.surveyFavorable', 'Favorable survey responses']
]);
add('listening', 'score', [['stock.pulseScoreTotal', 'Total pulse score']]);
add('service', 'count', [
  ['service.inflow', 'Incoming service cases'], ['service.resolved', 'Resolved service cases'],
  ['service.backlog', 'Open service backlog'], ['service.beginningBacklog', 'Beginning service backlog']
], false, 'Linked priority partitions and monthly queue continuity require a complete validated source import.');
add('service', 'count', [
  ['service.withinSLA', 'Cases resolved within SLA'], ['service.breachedResolved', 'Resolved cases outside SLA'],
  ['service.knowledgeViews', 'Knowledge article views'], ['service.knowledgeHelpful', 'Helpful knowledge views'],
  ['service.virtualAgentSessions', 'Virtual agent sessions'], ['service.virtualAgentResolved', 'Virtual agent resolutions'],
  ['service.humanHandoffs', 'Human handoffs']
]);
add('service', 'count', [['service.breachedOpen', 'Open cases outside SLA'], ['service.unassignedOpen', 'Unassigned open cases']], false,
  'Reconciles to source priority distributions. Use a complete validated source import.');
const fieldMap = new Map(fields.map(field => [field.path, field]));
const get = (row, path) => path.split('.').reduce((value, part) => value && Object.hasOwn(value, part) ? value[part] : undefined, row);
function cellKey(row) { return JSON.stringify([row.month, row.function, row.region]); }
function set(row, path, value) {
  const parts = path.split('.'), leaf = parts.pop();
  const parent = parts.reduce((node, part) => node[part], row);
  parent[leaf] = value;
}
function dimensions(snapshot, filters = {}, exact = false) {
  if (!snapshot || !Array.isArray(snapshot.cells)) throw sourceError('A source snapshot is required.');
  if (exact && (!filters.month || !filters.function || !filters.region)) throw sourceError('Source edits require an exact month, function and region.');
  const month = filters.month ?? snapshot.months.at(-1), fn = filters.function ?? 'all', region = filters.region ?? 'all';
  if (!snapshot.months.includes(month)) throw sourceError('Choose a month from the source catalogue.');
  if (!(snapshot.functions.includes(fn) || (!exact && fn === 'all'))) throw sourceError('Choose a function from the source catalogue.');
  if (!(snapshot.regions.includes(region) || (!exact && region === 'all'))) throw sourceError('Choose a region from the source catalogue.');
  return { month, function: fn, region };
}
export function sourceCatalog(snapshot) {
  return clone({ sourceVersion: snapshot.sourceVersion, months: snapshot.months, functions: snapshot.functions,
    regions: snapshot.regions, categories, fields,
    limitations: ['Synthetic aggregate source data. Protected demographic subdivisions and cohort histories are unavailable here.',
      'Costs are annual run-rate source values unless their label states otherwise. Edits require an exact month, function and region.',
      'Proposals do not alter the source. Applying a confirmed proposal creates a new source revision.'] });
}
export function inspectSourceData(snapshot, filters = {}) {
  const scope = dimensions(snapshot, filters), category = filters.category ?? 'all';
  if (category !== 'all' && !categories.some(item => item.id === category)) throw sourceError('Choose a category from the source catalogue.');
  const selectedFields = fields.filter(field => category === 'all' || field.category === category), rows = [];
  for (const cell of snapshot.cells) {
    if (cell.month !== scope.month || (scope.function !== 'all' && cell.function !== scope.function) || (scope.region !== 'all' && cell.region !== scope.region)) continue;
    for (const field of selectedFields) {
      const value = get(cell, field.path);
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      rows.push({ month: cell.month, function: cell.function, region: cell.region,
        path: field.path, label: field.label, value, unit: field.unit, editable: field.editable, ...(field.reason ? { reason: field.reason } : {}) });
    }
  }
  const maxRows = 300, totalRows = rows.length, truncated = totalRows > maxRows;
  return { sourceVersion: snapshot.sourceVersion, filters: { ...scope, category }, rows: rows.slice(0, maxRows),
    totalRows, truncated, limits: { maxRows, totalRows, truncated },
    ...(truncated ? { message: 'Preview limited to 300 field rows. Narrow the function, region or category to inspect the remaining fields.' } : {}) };
}
function validValue(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e13) throw sourceError('Source values must be finite, nonnegative and at most 10 trillion.');
  if (field.unit === 'count' && !Number.isSafeInteger(value)) throw sourceError(`${field.label} requires a whole-number count.`);
  if (field.unit === 'usd' && Math.abs(value * 100 - Math.round(value * 100)) > 0.001) throw sourceError(`${field.label} supports at most two decimal places.`);
}
function validateRelations(candidate) {
  for (const { stock: s, flow: f, service: q } of candidate.cells) {
    const pairs = [
      [s.managers, s.headcount, 'Managers / headcount'], [s.hrStaff, s.headcount, 'HR staff / headcount'],
      [f.regrettableExits, f.voluntaryExits, 'Regrettable / voluntary exits'],
      [s.successionReadyNow, s.successionPriorityRoles, 'Successors ready / priority roles'],
      [s.criticalCapabilityReady, s.criticalCapabilityRequired, 'Capabilities ready / required'],
      [f.absenceDays, f.scheduledDays, 'Absence / scheduled days'],
      [f.screened, f.applications, 'Screened candidates / applications'],
      [f.interviewed, f.screened, 'Interviewed / screened candidates'],
      [f.offers, f.interviewed, 'Offers / interviewed candidates'], [f.accepted, f.offers, 'Accepted offers / offers'],
      [s.surveyInvited, s.headcount, 'Survey invitations / employee population'],
      [f.projectsConverted, f.trainingDemands, 'Projects converted / training demands'],
      [q.knowledgeHelpful, q.knowledgeViews, 'Helpful / total knowledge views'],
      [q.virtualAgentResolved, q.virtualAgentSessions, 'Virtual agent resolutions / sessions'],
      [q.humanHandoffs, q.virtualAgentSessions, 'Human handoffs / virtual agent sessions']
    ];
    for (const [numerator, denominator, label] of pairs) if (numerator > denominator)
      throw sourceError(`Source change rejected: ${label} would be inconsistent.`);
    if (q.withinSLA + q.breachedResolved !== q.resolved)
      throw sourceError('Source change rejected: resolved cases must equal cases within SLA plus cases outside SLA. Include both exact changes in the proposal.');
    if (q.virtualAgentResolved + q.humanHandoffs !== q.virtualAgentSessions)
      throw sourceError('Source change rejected: virtual agent sessions must equal reported resolutions plus human handoffs in this synthetic source. Include the matching exact changes in the proposal.');
  }
}
// Pure preparation: no persistence or mutation. Caller validates the whole dataset
// before persisting either the proposal or its subsequent exact application.
export function prepareSourceChanges(snapshot, requested) {
  if (!Array.isArray(requested) || !requested.length || requested.length > 12) throw sourceError('A proposal needs between 1 and 12 exact source changes.');
  const candidate = clone(snapshot), changes = [], seen = new Set(), costCells = new Set();
  for (const change of requested) {
    if (!change || typeof change !== 'object' || Array.isArray(change)) throw sourceError('Each source change must be an object.');
    const allowed = new Set(['month', 'function', 'region', 'path', 'operation', 'value']);
    if (Object.keys(change).some(key => !allowed.has(key))) throw sourceError('Unknown source change field.');
    const field = fieldMap.get(change.path);
    if (!field || !field.editable) throw sourceError(field?.reason || 'This source path is not available for editing.');
    const scope = dimensions(snapshot, change, true), cell = candidate.cells.find(row => cellKey(row) === cellKey(scope));
    const id = `${cellKey(scope)}|${field.path}`;
    if (seen.has(id)) throw sourceError('Each exact source field may appear only once in a proposal.');
    seen.add(id);
    if (!cell || typeof get(cell, field.path) !== 'number') throw sourceError('The requested source field is missing.');
    const operation = change.operation ?? 'set';
    if (!['set', 'add', 'scale'].includes(operation)) throw sourceError('Supported source operations are set, add and scale.');
    if (typeof change.value !== 'number' || !Number.isFinite(change.value) || Math.abs(change.value) > 1e13) throw sourceError('A finite numeric source change is required.');
    const before = get(cell, field.path);
    let after = operation === 'set' ? change.value : operation === 'add' ? before + change.value : before * change.value;
    // Arithmetic is server-owned; currency operations round to cents, while direct
    // set operations retain the caller's exact value and reject excess precision.
    if (field.unit === 'usd' && operation !== 'set') after = Math.round(after * 100) / 100;
    validValue(after, field);
    if (before === after) continue;
    set(cell, field.path, after);
    changes.push({ ...scope, path: field.path, label: field.label, unit: field.unit, operation, value: change.value, before, after, derived: false });
    if (field.path.startsWith('stock.costBreakdown.')) costCells.add(cellKey(scope));
  }
  for (const id of costCells) {
    const cell = candidate.cells.find(row => cellKey(row) === id), before = cell.stock.annualCostRunRate;
    const after = Object.values(cell.stock.costBreakdown).reduce((total, value) => total + value, 0);
    if (!Number.isFinite(after) || after > 1e13) throw sourceError('Reconciled annual workforce cost exceeds the supported value range.');
    cell.stock.annualCostRunRate = after;
    if (before !== after) changes.push({ month: cell.month, function: cell.function, region: cell.region, path: 'stock.annualCostRunRate',
      label: 'Annual workforce cost', unit: 'usd', before, after, derived: true });
  }
  if (!changes.length) throw sourceError('The proposed values are unchanged.');
  validateRelations(candidate);
  return { candidate, changes };
}
export function applySourceChanges(snapshot, changes, reverse = false) {
  const candidate = clone(snapshot);
  for (const change of changes) {
    const cell = candidate.cells.find(row => cellKey(row) === cellKey(change));
    const field = fieldMap.get(change.path);
    if (!cell || !field || (!field.editable && !(change.derived && change.path === 'stock.annualCostRunRate'))) throw sourceError('Stored source change is not supported.', 409);
    const expected = reverse ? change.after : change.before, next = reverse ? change.before : change.after;
    if (get(cell, change.path) !== expected) throw sourceError('The source no longer matches the exact proposal. Create a fresh proposal.', 409);
    validValue(next, field);
    set(cell, change.path, next);
  }
  validateRelations(candidate);
  return candidate;
}
