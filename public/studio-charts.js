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
        caption: [b.periodLabel, b.where, b.definition, 'Common zero baseline. Each ratio uses its own segment denominator.'].filter(Boolean).join(' · '),
        overall: b.overall && finite(b.overall.value) ? b.overall : null
      };
    }
    if (ins?.id === 'costVariance' && Array.isArray(ins.rows) && ins.rows.length) {
      return {
        title: ins.chartTitle || 'Workforce cost against plan', eyebrow: 'ANNUAL RUN-RATE VARIANCE',
        rows: ins.rows.map(row => ({ label: clean(row.label), value: finite(row.variance) ? row.variance : null, formatted: clean(row.formatted), fact: (response.facts || []).findIndex(f => /contributor|own plan/i.test(f.label) && String(f.value).startsWith(row.label)) })),
        caption: [ins.periodLabel, 'USD. Positive values are over plan; negative values are under plan. These are run-rate differences, not booked savings.'].filter(Boolean).join(' · ')
      };
    }
    if (ins?.id === 'onboardingExits' && !ins.suppressed && finite(ins.delayedExitRate) && finite(ins.onTimeExitRate)) {
      if ([ins.delayedExitRate, ins.onTimeExitRate].some(rate => rate < 0 || rate > 1)) return null;
      const fact = factIndex(response, 'First-year exit rate');
      return {
        title: 'Two starts. Different first-year outcomes.', eyebrow: 'OBSERVED COHORT · FIRST-YEAR EXITS',
        rows: [
          { label: 'Delayed onboarding', value: ins.delayedExitRate, formatted: (ins.delayedExitRate * 100).toFixed(1) + '%', fact },
          { label: 'On-time onboarding', value: ins.onTimeExitRate, formatted: (ins.onTimeExitRate * 100).toFixed(1) + '%', fact }
        ],
        caption: [ins.periodLabel, 'Percentage of hires who exited within 12 months, in each onboarding group. Association, not proof of cause.'].filter(Boolean).join(' · ')
      };
    }
    const computed = response.presentation?.chart;
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
      return { type: computed.type, title: clean(computed.title), eyebrow: 'CALCULATED SCENARIO · ' + (computed.unit === 'usd' ? 'USD' : caseId === 'service' ? 'OPEN CASES' : 'CAPACITY'), rows, symmetric: retention,
        caption: [units[caseId] || computed.unit, computed.basis, retention ? 'Costs extend left of zero. Net is gross less program cost; not booked cash.' : 'Geometry uses the server-calculated values.'].filter(Boolean).join(' · ') };
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
        title: 'The value of the assumption.', eyebrow: 'RETENTION SCENARIO · USD', symmetric: true, rows,
        caption: 'Next 1,200 hires · 12 months. Costs are shown as outflows, left of zero. Net is gross modeled value less program cost. Conditional assumptions; not booked cash. Bar lengths use the rounded amounts shown.'
      };
    }
    return null;
  }
  function drawLine(svg, cfg, height, targets) {
    const rows = cfg.rows, values = rows.filter(row => finite(row.value)).map(row => row.value);
    if (!values.length) return;
    const top = 68, bottom = height - 65, left = 67, right = 725;
    const low = Math.min(0, ...values), high = Math.max(...values, low + 1);
    const x = index => left + index / Math.max(1, rows.length - 1) * (right - left);
    const y = value => bottom - (value - low) / (high - low) * (bottom - top);
    const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
    for (const value of [...new Set([low, (low + high) / 2, high])]) {
      svg.append(svgNode('line', { x1: left, x2: right, y1: y(value), y2: y(value), stroke: C.line, 'stroke-opacity': '.23' }));
      svg.append(svgNode('text', { x: left - 14, y: y(value) + 5, fill: C.muted, 'font-size': 17, 'text-anchor': 'end' }, number(value)));
    }
    // Separate subpaths at missing values; do not interpolate a suppressed period.
    let path = '', connected = false;
    rows.forEach((row, index) => { if (row.value === null) { connected = false; return; } path += (connected ? ' L' : ' M') + x(index) + ' ' + y(row.value); connected = true; });
    if (rows.every(row => row.value !== null)) svg.append(svgNode('path', { d: path + ' L' + right + ' ' + bottom + ' L' + left + ' ' + bottom + ' Z', fill: C.mint, 'fill-opacity': '.07' }));
    svg.append(svgNode('path', { d: path, fill: 'none', stroke: C.mint, 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    rows.forEach((row, index) => {
      const group = svgNode('g', { class: 'studio-chart-row' });
      if (row.fact >= 0) group.setAttribute('data-fact-index', row.fact);
      group.append(svgNode('title', {}, row.label + ': ' + (row.value === null ? 'Suppressed' : row.formatted)));
      let marker = null;
      if (row.value !== null) {
        marker = svgNode('circle', { cx: x(index), cy: y(row.value), r: index === rows.length - 1 ? 6 : 4.5, fill: index === rows.length - 1 ? C.violet : C.mint, stroke: '#101a2d', 'stroke-width': 2 });
        group.append(marker);
        if (index === 0 || index === rows.length - 1 || (row.value !== 0 && rows.length <= 14)) group.append(svgNode('text', { x: x(index), y: y(row.value) - 15, fill: C.text, 'font-size': 17, 'font-weight': 600, 'text-anchor': 'middle' }, row.formatted));
      }
      const showLabel = index === 0 || index === rows.length - 1 || index % Math.max(1, Math.ceil((rows.length - 1) / 4)) === 0;
      if (showLabel) group.append(svgNode('text', { x: x(index), y: bottom + 29, fill: C.muted, 'font-size': 17, 'text-anchor': index === rows.length - 1 ? 'end' : index === 0 ? 'start' : 'middle' }, row.label));
      svg.append(group); targets.push({ group, marker, fact: row.fact });
    });
  }
  function render(response) {
    if (!response || typeof response !== 'object') return null;
    const cfg = config(response);
    if (!cfg?.rows?.length || cfg.rows.length > 24) return null;
    const rows = cfg.rows, values = rows.filter(row => finite(row.value)).map(row => row.value);
    const id = 'studio-chart-' + (++serial);
    const figure = document.createElement('figure'); figure.className = 'studio-chart';
    figure.style.cssText = 'margin:0;min-width:0;color:' + C.text;
    // A minimum row height retains legibility if a future response has more segments.
    const height = cfg.type === 'line' ? 320 : Math.max(320, rows.length * 28 + 104);
    const svg = svgNode('svg', { viewBox: '0 0 760 ' + height, role: 'img', 'aria-labelledby': id + '-title ' + id + '-description', width: '100%', preserveAspectRatio: 'xMidYMid meet' });
    svg.style.cssText = 'display:block;width:100%;min-width:640px;height:auto;overflow:visible;font-family:Inter,ui-sans-serif,system-ui,sans-serif';
    svg.append(svgNode('title', { id: id + '-title' }, cfg.title));
    svg.append(svgNode('desc', { id: id + '-description' }, rows.map(row => row.label + ': ' + (row.value === null ? 'Suppressed; no bar shown' : row.formatted)).join('. ') + '. ' + cfg.caption));
    svg.append(svgNode('text', { x: 12, y: 22, fill: C.muted, 'font-size': 12, 'letter-spacing': '1.8' }, cfg.eyebrow));
    const targets = [];
    if (cfg.type === 'line') drawLine(svg, cfg, height, targets);
    else {
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
    const caption = document.createElement('figcaption'); caption.className = 'studio-chart-caption';
    caption.style.cssText = 'font:400 12px/1.6 Inter,ui-sans-serif,system-ui,sans-serif;color:' + C.muted + ';max-width:760px;padding:0 12px';
    caption.textContent = cfg.caption + (rows.some(row => row.value === null) ? ' Suppressed groups have no numerical bar.' : '') + (cfg.overall ? ' ' + clean(cfg.overall.label) + ': ' + clean(cfg.overall.formatted) + '.' : '');
    const viewport = document.createElement('div'); viewport.className = 'studio-chart-viewport';
    viewport.style.cssText = 'max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin';
    viewport.tabIndex = 0; viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', cfg.title + '. On narrow screens, scroll horizontally for all values.');
    viewport.append(svg); figure.append(viewport, caption);
    figure.highlight = index => {
      for (const target of targets) {
        const active = Number.isInteger(index) && index >= 0 && target.fact === index;
        target.group.classList.toggle('is-focused', active);
        target.group.setAttribute('data-active', String(active));
        target.background?.setAttribute('opacity', active ? '.11' : '0');
        target.label?.setAttribute('fill', active ? C.text : C.muted);
        target.marker?.setAttribute('r', active ? '8' : '4.5');
      }
    };
    return figure;
  }
  window.WI_STUDIO_CHARTS = Object.freeze({ render });
})();
