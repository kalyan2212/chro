/* Presentation of verified response data only. Missing values never become zero. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const C = { text: '#e9edf5', muted: '#aab3c9', mint: '#a9eecc', violet: '#b6a4ff', line: '#68748d', track: '#263147' };
  let serial = 0;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const clean = value => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 500);
  function svgNode(tag, attributes = {}, text) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text != null) node.textContent = clean(text);
    return node;
  }
  function factIndex(response, label) {
    return (response.facts || []).findIndex(f => f.label === label);
  }
  function money(value) {
    if (typeof value !== 'string') return null;
    const match = value.trim().replace(/\u2212/g, '-').match(/^([+-]?)\$([\d,]+(?:\.\d+)?)\s*(k|m|bn|b)?$/i);
    if (!match) return null;
    const amount = Number(match[2].replace(/,/g, '')) * ({ k: 1e3, m: 1e6, b: 1e9, bn: 1e9 }[match[3]?.toLowerCase()] || 1) * (match[1] === '-' ? -1 : 1);
    return Number.isFinite(amount) ? amount : null;
  }
  function config(response) {
    const b = response.breakdown, ins = response.insight;
    if (b && Array.isArray(b.rows) && b.rows.length) {
      const periods = b.dimension === 'month';
      return {
        title: b.label + (periods ? ' over time' : ' by ' + b.dimension),
        eyebrow: periods ? 'PERIOD COMPARISON' : 'SEGMENT COMPARISON',
        rows: b.rows.map(row => ({ label: clean(row.label), value: finite(row.value) ? row.value : null, formatted: clean(row.formatted || 'Suppressed'), fact: factIndex(response, row.label) })),
        unit: b.unit, temporal: periods,
        caption: [b.periodLabel, b.where, b.definition, b.unit === 'ratio' ? 'Each ratio uses its own segment denominator.' : 'Values use the stated common measure and period.'].filter(Boolean).join(' · '),
        overall: b.overall && finite(b.overall.value) ? b.overall : null
      };
    }
    if (ins?.id === 'costVariance' && Array.isArray(ins.rows) && ins.rows.length) {
      return {
        title: ins.chartTitle || 'Workforce cost against plan', eyebrow: 'ANNUAL RUN-RATE VARIANCE', unit: 'usd',
        rows: ins.rows.map(row => ({ label: clean(row.label), value: finite(row.variance) ? row.variance : null, formatted: clean(row.formatted), fact: (response.facts || []).findIndex(f => /contributor|own plan/i.test(f.label) && String(f.value).startsWith(row.label)) })),
        caption: [ins.periodLabel, 'USD. Positive values are over plan; negative values are under plan. These are run-rate differences, not booked savings.'].filter(Boolean).join(' · ')
      };
    }
    if (ins?.id === 'onboardingExits' && !ins.suppressed && finite(ins.delayedExitRate) && finite(ins.onTimeExitRate)) {
      if ([ins.delayedExitRate, ins.onTimeExitRate].some(rate => rate < 0 || rate > 1)) return null;
      const fact = factIndex(response, 'First-year exit rate');
      return {
        title: 'Two starts. Different first-year outcomes.', eyebrow: 'OBSERVED COHORT · FIRST-YEAR EXITS', unit: 'ratio',
        rows: [
          { label: 'Delayed onboarding', value: ins.delayedExitRate, formatted: (ins.delayedExitRate * 100).toFixed(1) + '%', fact },
          { label: 'On-time onboarding', value: ins.onTimeExitRate, formatted: (ins.onTimeExitRate * 100).toFixed(1) + '%', fact }
        ],
        caption: [ins.periodLabel, 'Percentage of hires who exited within 12 months, in each onboarding group. Association, not proof of cause.'].filter(Boolean).join(' · ')
      };
    }
    const computed = response.presentation?.chart;
    if (response.action?.type === 'metric' && computed?.type === 'bar' && computed.unit === 'usd' && Array.isArray(computed.rows) && computed.rows.length) {
      return {
        title: clean(computed.title), eyebrow: 'OBSERVED COST COMPONENTS · USD', unit: 'usd',
        rows: computed.rows.map(row => ({ label: clean(row.label), value: finite(row.value) ? row.value : null, formatted: finite(row.value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(row.value) : 'Suppressed', fact: factIndex(response, row.label) })),
        caption: [computed.basis, 'USD. The total is not added as another component.'].filter(Boolean).join(' · ')
      };
    }
    if (response.action?.type === 'scenario' && computed && ['bar', 'line'].includes(computed.type) && ['usd', 'count'].includes(computed.unit) && Array.isArray(computed.rows) && computed.rows.length) {
      const caseId = response.action.caseId, retention = caseId === 'retention';
      const units = { retention: 'USD · 12 months', service: 'Open cases · forward 12 months', skills: 'FTE', capacity: 'FTE', continuity: 'Services', delivery: 'Accepted units per week' };
      const format = value => new Intl.NumberFormat('en-US', computed.unit === 'usd' ? { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 }).format(value);
      const rows = computed.rows.map((row, index) => {
        let fact = factIndex(response, row.label);
        if (fact < 0 && ['skills', 'capacity'].includes(caseId)) fact = factIndex(response, 'Ready / gap');
        if (fact < 0 && caseId === 'continuity') fact = factIndex(response, 'Covered / uncovered services');
        if (fact < 0 && caseId === 'service' && index === computed.rows.length - 1) fact = factIndex(response, 'Closing backlog');
        const value = finite(row.value) ? (retention && row.label === 'Program cost' ? -Math.abs(row.value) : row.value) : null;
        return { label: clean(row.label), value, formatted: value === null ? 'Suppressed' : format(value), fact };
      });
      return { type: computed.type, unit: computed.unit, temporal: caseId === 'service', title: clean(computed.title), eyebrow: 'CALCULATED SCENARIO · ' + (computed.unit === 'usd' ? 'USD' : caseId === 'service' ? 'OPEN CASES' : 'CAPACITY'), rows, symmetric: retention,
        caption: [units[caseId] || computed.unit, computed.basis, retention ? 'Program cost is an outflow. Net is gross less program cost; not booked cash.' : 'Geometry uses the server-calculated values.'].filter(Boolean).join(' · ') };
    }
    if (response.action?.type === 'scenario' && response.action.caseId === 'retention') {
      const labels = ['Gross modeled value', 'Program cost', 'Net modeled value'];
      const rows = labels.map(label => {
        const fact = factIndex(response, label), field = response.facts?.[fact], amount = money(field?.value);
        if (amount === null) return null;
        const cost = label === 'Program cost';
        return { label, value: cost ? -Math.abs(amount) : amount, formatted: cost && amount > 0 ? '−' + field.value : clean(field.value), fact };
      });
      if (rows.some(row => !row)) return null;
      return {
        title: 'The value of the assumption.', eyebrow: 'RETENTION SCENARIO · USD', unit: 'usd', symmetric: true, rows,
        caption: 'Next 1,200 hires · 12 months. Costs are shown as negative outflows. Net is gross modeled value less program cost. Conditional assumptions; not booked cash. Geometry uses the rounded amounts shown.'
      };
    }
    return null;
  }
  function drawBar(svg, cfg, height, targets) {
    const rows = cfg.rows, values = rows.filter(row => finite(row.value)).map(row => row.value);
    // Dedicated label and value columns avoid labels colliding with bars or axes.
    const left = 203, right = 592, rowTop = 60, rowBottom = height - 48;
    const spacing = (rowBottom - rowTop) / rows.length, barHeight = Math.min(35, Math.max(12, spacing - 15));
    let low = Math.min(0, ...values), high = Math.max(0, ...values);
    if (cfg.symmetric) { const extent = Math.max(Math.abs(low), high, 1); low = -extent; high = extent; }
    else if (low === high) high = low + 1;
    const x = value => left + (value - low) / (high - low) * (right - left), zero = x(0);
    // Quarter-grid lines aid magnitude comparison without inventing intermediate labels.
    [0, .25, .5, .75, 1].forEach(part => svg.append(svgNode('line', { x1: left + part * (right - left), x2: left + part * (right - left), y1: rowTop - 17, y2: rowBottom + 2, stroke: C.line, 'stroke-opacity': '.12' })));
    rows.forEach((row, i) => {
      const center = rowTop + spacing * (i + .5), group = svgNode('g', { class: 'studio-chart-row' });
      if (row.fact >= 0) group.setAttribute('data-fact-index', row.fact);
      group.append(svgNode('title', {}, row.label + ': ' + (row.value === null ? 'Suppressed' : row.formatted)));
      const background = svgNode('rect', { x: 0, y: center - spacing / 2 + 2, width: 758, height: Math.max(spacing - 4, 16), rx: 8, fill: C.violet, opacity: 0, class: 'studio-chart-focus' });
      group.append(background);
      const label = svgNode('text', { x: left - 15, y: center + 5, fill: C.muted, 'font-size': 17, 'text-anchor': 'end' }, row.label);
      // The shipped longest labels fit the 188px column. Text length is bounded for future data.
      if (row.label.length > 20) { label.setAttribute('textLength', '180'); label.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
      group.append(label);
      if (row.value !== null) {
        const start = x(Math.min(0, row.value)), finish = x(Math.max(0, row.value));
        if (finish > start) group.append(svgNode('rect', { x: start, y: center - barHeight / 2, width: Math.max(.5, finish - start), height: barHeight, rx: Math.min(5, (finish - start) / 2), fill: row.value < 0 || i % 2 ? C.violet : C.mint, class: 'studio-chart-bar' }));
        else group.append(svgNode('circle', { cx: zero, cy: center, r: 2.5, fill: C.muted }));
      }
      const shown = row.value === null ? 'Suppressed' : row.formatted;
      const valueLabel = svgNode('text', { x: 750, y: center + 5, fill: row.value === null ? C.muted : C.text, 'font-size': 17, 'font-weight': 600, 'text-anchor': 'end' }, shown);
      if (shown.length > 18) { valueLabel.setAttribute('textLength', '147'); valueLabel.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
      group.append(valueLabel); svg.append(group); targets.push({ group, background, label, fact: row.fact });
    });
    svg.append(svgNode('line', { x1: zero, x2: zero, y1: rowTop - 17, y2: rowBottom + 3, stroke: C.muted, 'stroke-opacity': '.7', 'stroke-width': 1 }));
    svg.append(svgNode('text', { x: zero, y: rowBottom + 24, fill: C.muted, 'font-size': 17, 'text-anchor': 'middle' }, '0'));
  }

  const preferences = new Map(), records = [], MAX_PREFERENCES = 80;
  const palette = [C.mint, C.violet, '#f0bd8d', '#7cbde8', '#e99dc5', '#dbd782', '#96c9b4', '#b4bfe0'];
  function pieReason(response, cfg) {
    if (cfg.rows.some(row => row.value === null)) return 'Pie is unavailable while any value is suppressed or missing.';
    if (cfg.rows.some(row => row.value < 0)) return 'Pie cannot represent negative values. Bar and line preserve their signs.';
    if (!cfg.rows.some(row => row.value > 0)) return 'Pie needs a positive total; these values are all zero.';
    if (cfg.temporal) return 'These are repeated periods, not parts of one total. Use bar or line.';
    if (cfg.unit === 'ratio') return 'Rates have separate denominators; they are not slices of one total.';
    const b = response.breakdown;
    if (b && ['E01', 'E02'].includes(b.metricId) && ['function', 'region'].includes(b.dimension)) {
      if (new Set(b.rows.map(row => row.segment)).size !== b.rows.length || b.rows.some(row => typeof row.segment !== 'string' || !row.segment || typeof row.period !== 'string' || !row.period) || new Set(b.rows.map(row => row.period)).size !== 1) return 'Pie requires distinct segments measured over the same period.';
      return '';
    }
    const names = ['Employee loaded cost', 'Overtime', 'External contractors'];
    if (response.action?.type === 'metric' && response.action.metricId === 'E02' && cfg.rows.length === 3 && names.every(name => cfg.rows.some(row => row.label === name))) return '';
    return 'These measures are not verified parts of a single total. Use bar or line to keep their meaning.';
  }
  function identity(response, cfg) {
    const input = JSON.stringify([response.sourceVersion, response.scope, response.action, response.breakdown?.dimension, cfg.title, cfg.rows.map(row => [row.label, row.value, row.formatted])]);
    let a = 2166136261, b = 5381;
    for (let i = 0; i < input.length; i++) { a = Math.imul(a ^ input.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ input.charCodeAt(i); }
    return 'chart-' + (a >>> 0).toString(36) + '-' + (b >>> 0).toString(36);
  }
  function metadata(response, cfg, chartId = identity(response, cfg)) {
    const reason = pieReason(response, cfg), availableTypes = reason ? ['bar', 'line'] : ['bar', 'line', 'pie'];
    const defaultType = cfg.type === 'line' ? 'line' : 'bar', saved = preferences.get(chartId);
    return { chartId, title: cfg.title, currentType: availableTypes.includes(saved) ? saved : defaultType, defaultType, availableTypes, reasons: reason ? { pie: reason } : {}, sourceVersion: response.sourceVersion || '', scope: structuredClone(response.scope || null) };
  }
  function describe(response) {
    if (!response || typeof response !== 'object') return null;
    const cfg = config(response);return cfg?.rows?.length && cfg.rows.length <= 24 ? metadata(response, cfg) : null;
  }
  const visible = record => record.figure.isConnected && record.figure.getClientRects().length > 0;
  function currentRecord(target) {
    return [...records].reverse().find(record => visible(record) && (target == null || (typeof target === 'string' ? record.chartId === target : record.figure === target)));
  }
  function getActive() { const record = currentRecord();return record ? metadata(record.response, record.cfg, record.chartId) : null; }
  function applyHighlight(record, index) {
    record.highlightIndex = index;
    for (const target of record.targets) {
      const active = Number.isInteger(index) && index >= 0 && target.fact === index;
      target.group?.classList.toggle('is-focused', active);target.group?.setAttribute('data-active', String(active));
      target.background?.setAttribute('opacity', active ? '.11' : '0');target.label?.setAttribute('fill', active ? C.text : C.muted);
      target.marker?.setAttribute('r', active ? '8' : '4.5');target.slice?.setAttribute('stroke', active ? C.text : '#101a2d');target.slice?.setAttribute('stroke-width', active ? '3' : '1');
      target.legend?.setAttribute('aria-current', String(active));
    }
  }
  function setType(type, target, origin = 'api') {
    const record = currentRecord(target);
    if (!record) return { ok: false, changed: false, chartId: typeof target === 'string' ? target : null, type, message: 'That chart is no longer visible. Open the evidence you want to change.' };
    const meta = metadata(record.response, record.cfg, record.chartId);
    if (!meta.availableTypes.includes(type)) return { ok: false, changed: false, chartId: record.chartId, type: meta.currentType, message: meta.reasons[type] || 'Choose bar, line or an available pie chart.' };
    const changed = type !== meta.currentType;
    if (changed) {
      preferences.delete(record.chartId);preferences.set(record.chartId, type);while (preferences.size > MAX_PREFERENCES) preferences.delete(preferences.keys().next().value);
      for (const instance of records.filter(item => item.chartId === record.chartId && visible(item))) paint(instance);
      dispatchEvent(new CustomEvent('wi-chart-type-changed', { detail: { chartId: record.chartId, type, title: record.cfg.title, origin } }));
    }
    const message = changed ? 'Showing ' + type + ' chart: ' + record.cfg.title + '.' : 'This chart is already shown as ' + type + '.';
    record.status.textContent = message;return { ok: true, changed, chartId: record.chartId, type, message };
  }
  function axisLabel(value, cfg) {
    if (cfg.unit === 'ratio') return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(value);
    return new Intl.NumberFormat('en-US', { ...(cfg.unit === 'usd' ? { style: 'currency', currency: 'USD' } : {}), notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
  }
  function drawLine(svg, cfg, height, targets) {
    const rows = cfg.rows, values = rows.filter(row => finite(row.value)).map(row => row.value);if (!values.length) return;
    const top = 66, bottom = height - 67, left = 83, right = 723, low = Math.min(0, ...values), high = Math.max(0, ...values) === low ? low + 1 : Math.max(0, ...values);
    const x = index => rows.length === 1 ? (left + right) / 2 : left + index / (rows.length - 1) * (right - left), y = value => bottom - (value - low) / (high - low) * (bottom - top);
    for (const value of [...new Set([low, (low + high) / 2, high, 0])].filter(value => value >= low && value <= high)) {svg.append(svgNode('line', { x1: left, x2: right, y1: y(value), y2: y(value), stroke: C.line, 'stroke-opacity': value === 0 ? '.6' : '.23' }));svg.append(svgNode('text', { x: left - 12, y: y(value) + 5, fill: C.muted, 'font-size': 16, 'text-anchor': 'end' }, axisLabel(value, cfg)));}
    let path = '', connected = false;rows.forEach((row, index) => {if (row.value === null) {connected = false;return;}path += (connected ? ' L' : ' M') + x(index) + ' ' + y(row.value);connected = true;});
    svg.append(svgNode('path', { d: path, fill: 'none', stroke: C.mint, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'studio-chart-line' }));
    rows.forEach((row, index) => {
      const group = svgNode('g', { class: 'studio-chart-row' });if (row.fact >= 0) group.setAttribute('data-fact-index', row.fact);group.append(svgNode('title', {}, row.label + ': ' + (row.value === null ? 'Suppressed' : row.formatted)));
      let marker = null;const anchor = index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle';
      if (row.value !== null) {marker = svgNode('circle', { cx: x(index), cy: y(row.value), r: 4.5, fill: index === rows.length - 1 ? C.violet : C.mint, stroke: '#101a2d', 'stroke-width': 2 });group.append(marker);if (rows.length <= 5 || index === 0 || index === rows.length - 1) group.append(svgNode('text', { x: x(index), y: y(row.value) - 14, fill: C.text, 'font-size': 16, 'font-weight': 600, 'text-anchor': anchor }, row.formatted));}
      if (rows.length <= 5 || index === 0 || index === rows.length - 1 || index % Math.ceil((rows.length - 1) / 4) === 0) {const label = svgNode('text', { x: x(index), y: bottom + 29, fill: C.muted, 'font-size': 16, 'text-anchor': anchor }, row.label);if (row.label.length > 22) {label.setAttribute('textLength', 180);label.setAttribute('lengthAdjust', 'spacingAndGlyphs');}group.append(label);}
      svg.append(group);targets.push({ group, marker, fact: row.fact });
    });
  }
  function drawPie(svg, cfg, targets) {
    const total = cfg.rows.reduce((sum, row) => sum + row.value, 0), cx = 180, cy = 167, radius = 119;let angle = -Math.PI / 2;
    cfg.rows.forEach((row, index) => {
      const group = svgNode('g', { class: 'studio-chart-row' });if (row.fact >= 0) group.setAttribute('data-fact-index', row.fact);group.append(svgNode('title', {}, row.label + ': ' + row.formatted));let slice = null;
      if (row.value > 0) {const end = angle + row.value / total * Math.PI * 2, x1 = cx + radius * Math.cos(angle), y1 = cy + radius * Math.sin(angle), x2 = cx + radius * Math.cos(end), y2 = cy + radius * Math.sin(end);
        slice = row.value === total ? svgNode('circle', { cx, cy, r: radius }) : svgNode('path', { d: `M${cx} ${cy} L${x1} ${y1} A${radius} ${radius} 0 ${end - angle > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z` });
        slice.setAttribute('fill', palette[index % palette.length]);slice.setAttribute('stroke', '#101a2d');slice.setAttribute('stroke-width', '1');slice.setAttribute('class', 'studio-chart-slice');group.append(slice);angle = end;
      }
      svg.append(group);targets.push({ group, slice, fact: row.fact });
    });
  }
  function legend(record, type) {
    const list = document.createElement('ul');list.className = 'studio-chart-values';list.setAttribute('aria-label', 'Exact chart values');
    record.cfg.rows.forEach((row, index) => {const item = document.createElement('li');item.setAttribute('aria-current', 'false');const label = document.createElement('span'),value = document.createElement('strong');label.textContent = row.label;value.textContent = row.value === null ? 'Suppressed' : row.formatted;
      if (type === 'pie') {const swatch = document.createElement('i');swatch.className = 'studio-chart-swatch';swatch.style.background = palette[index % palette.length];swatch.setAttribute('aria-hidden', 'true');item.append(swatch);}item.append(label, value);list.append(item);record.targets.push({ legend: item, fact: row.fact });});return list;
  }
  function paint(record) {
    const { cfg, figure, body, caption, chartId } = record, meta = metadata(record.response, cfg, chartId), type = meta.currentType;
    figure.dataset.chartType = type;record.controls.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.chartType === type)));body.replaceChildren();record.targets = [];
    const height = type === 'bar' ? Math.max(320, cfg.rows.length * 28 + 104) : 320, pie = type === 'pie';
    const note = type === 'line' ? cfg.temporal ? 'Points follow the stated periods; missing observations are not connected.' : 'Lines connect named categories for comparison; this is not a time trend.' : pie ? 'Slices show the displayed categories only. Their exact values are listed; zero values have no slice.' : 'Common zero baseline; negative values extend to the left.';
    const explanation = [cfg.caption, note, cfg.rows.some(row => row.value === null) ? 'Suppressed values have no numerical mark.' : '', cfg.overall ? clean(cfg.overall.label) + ': ' + clean(cfg.overall.formatted) + '.' : ''].filter(Boolean).join(' ');
    const svg = svgNode('svg', { viewBox: `0 0 ${pie ? 360 : 760} ${height}`, role: 'img', 'aria-labelledby': record.id + '-title ' + record.id + '-description', width: '100%', preserveAspectRatio: 'xMidYMid meet' });
    svg.style.cssText = 'display:block;width:100%;min-width:' + (pie ? '0' : '640px') + ';height:auto;overflow:visible;font-family:Inter,ui-sans-serif,system-ui,sans-serif';
    svg.append(svgNode('title', { id: record.id + '-title' }, cfg.title + ' — ' + type + ' chart'),svgNode('desc', { id: record.id + '-description' }, cfg.rows.map(row => row.label + ': ' + (row.value === null ? 'Suppressed' : row.formatted)).join('. ') + '. ' + explanation));
    if (!pie) svg.append(svgNode('text', { x: 12, y: 22, fill: C.muted, 'font-size': 12, 'letter-spacing': '1.8' }, cfg.eyebrow));
    if (type === 'line') drawLine(svg, cfg, height, record.targets);else if (pie) drawPie(svg, cfg, record.targets);else drawBar(svg, cfg, height, record.targets);
    const viewport = document.createElement('div');viewport.className = 'studio-chart-viewport';viewport.tabIndex = 0;viewport.setAttribute('role', 'region');viewport.setAttribute('aria-label', cfg.title + (pie ? '.' : '. On narrow screens, scroll horizontally for all values.'));viewport.append(svg);body.append(viewport);
    if (type !== 'bar') body.append(legend(record, type));caption.textContent = explanation;applyHighlight(record, record.highlightIndex);
  }
  function render(response) {
    if (!response || typeof response !== 'object') return null;const cfg = config(response);if (!cfg?.rows?.length || cfg.rows.length > 24) return null;
    const figure = document.createElement('figure');figure.className = 'studio-chart';figure.style.cssText = 'margin:0;min-width:0;color:' + C.text;
    const meta = metadata(response, cfg), controls = document.createElement('div');controls.className = 'studio-chart-controls';controls.setAttribute('role', 'group');controls.setAttribute('aria-label', 'Chart display');
    for (const type of ['bar', 'line', 'pie']) {const button = document.createElement('button');button.type = 'button';button.textContent = type[0].toUpperCase() + type.slice(1);button.dataset.chartType = type;button.setAttribute('aria-label', 'Show ' + type + ' chart');button.disabled = !meta.availableTypes.includes(type);if (button.disabled) button.title = meta.reasons[type];button.addEventListener('click', () => setType(type, figure, 'control'));controls.append(button);}
    const body = document.createElement('div');body.className = 'studio-chart-body';const caption = document.createElement('figcaption');caption.className = 'studio-chart-caption';
    const status = document.createElement('span');status.className = 'studio-chart-status';status.setAttribute('role', 'status');status.setAttribute('aria-live', 'polite');
    figure.append(controls, body, caption);if (meta.reasons.pie) {const reason = document.createElement('p');reason.className = 'studio-chart-reason';reason.textContent = meta.reasons.pie;reason.id = 'chart-reason-' + serial;controls.querySelector('[data-chart-type=pie]').setAttribute('aria-describedby', reason.id);figure.append(reason);}figure.append(status);figure.dataset.chartId = meta.chartId;
    const record = { id: 'studio-chart-' + (++serial), chartId: meta.chartId, figure, response, cfg, controls, body, caption, status, targets: [], highlightIndex: -1 };records.push(record);while (records.length > 100) records.shift();
    figure.highlight = index => applyHighlight(record, index);paint(record);return figure;
  }
  window.WI_STUDIO_CHARTS = Object.freeze({ render, describe, getActive, setType });
})();
