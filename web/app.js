/* Cloud Console — latency chart, pipeline and deployment state. */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  const SERIES = [
    { key: 'p50', name: 'p50', colour: '#34d399', base: 18, spread: 6 },
    { key: 'p95', name: 'p95', colour: '#f97316', base: 84, spread: 18 },
    { key: 'p99', name: 'p99', colour: '#fb7185', base: 168, spread: 46 },
  ];

  const WINDOWS = { 1: { buckets: 60, label: 'last hour' }, 6: { buckets: 72, label: 'last 6 hours' }, 24: { buckets: 96, label: 'last 24 hours' } };

  const PIPELINE = [
    { stage: 'Lint & test', workflow: 'ci.yml', duration: '48s', result: 'passed', commit: 'a3f91c2' },
    { stage: 'Container build', workflow: 'ci.yml', duration: '1m 12s', result: 'passed', commit: 'a3f91c2' },
    { stage: 'Terraform plan', workflow: 'terraform.yml', duration: '34s', result: 'passed', commit: 'a3f91c2' },
    { stage: 'Migrate + deploy', workflow: 'deploy.yml', duration: '2m 06s', result: 'passed', commit: 'a3f91c2' },
    { stage: 'Smoke test', workflow: 'deploy.yml', duration: '18s', result: 'passed', commit: 'a3f91c2' },
  ];

  const DEPLOYS = [
    { version: 'v1.4.2', when: '42 min ago', note: 'current · feat: pool backpressure' },
    { version: 'v1.4.1', when: 'yesterday', note: 'fix: ready-check timeout' },
    { version: 'v1.4.0', when: '3 days ago', note: 'feat: metrics histogram' },
    { version: 'v1.3.9', when: 'last week', note: 'chore: bump aws provider' },
  ];

  const ENDPOINTS = [
    { method: 'GET', path: '/health', purpose: 'Liveness probe for the target group', p95: 4 },
    { method: 'GET', path: '/ready', purpose: 'Readiness — database and cache reachable', p95: 11 },
    { method: 'GET', path: '/metrics', purpose: 'Prometheus exposition', p95: 7 },
    { method: 'GET', path: '/api/v1/items', purpose: 'List items with cursor pagination', p95: 62 },
    { method: 'POST', path: '/api/v1/items', purpose: 'Create an item', p95: 91 },
  ];

  const el = {
    chart: $('#latencyChart'),
    legend: $('#legend'),
    hint: $('#chartHint'),
    p95: $('#hP95'),
    rps: $('#hRps'),
    err: $('#hErr'),
    pipeline: $('#pipelineBody'),
    deploys: $('#deploys'),
    endpoints: $('#endpoints'),
    toast: $('#toast'),
  };

  let windowKey = 6;
  let hidden = new Set();
  let seedTick = 0;

  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function build(series, buckets) {
    const random = rng(series.base * 977 + seedTick);
    const out = [];
    let value = series.base;
    for (let i = 0; i < buckets; i += 1) {
      value += (random() - 0.5) * series.spread;
      // occasional latency spike
      if (random() > 0.97) value += series.spread * 1.8;
      value = Math.max(series.base * 0.4, Math.min(series.base * 2.6, value));
      out.push(Math.round(value));
    }
    return out;
  }

  function tickLabels(buckets) {
    const labels = [];
    const stepMs = windowKey === 1 ? 60e3 : windowKey === 6 ? 5 * 60e3 : 15 * 60e3;
    for (let i = buckets - 1; i >= 0; i -= 1) {
      const t = new Date(Date.now() - i * stepMs);
      labels.push(t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    }
    return labels;
  }

  function drawChart() {
    const config = WINDOWS[windowKey];
    const buckets = config.buckets;
    const series = SERIES.map((s) => ({ ...s, values: build(s, buckets) }));
    const visible = series.filter((s) => !hidden.has(s.key));

    el.hint.textContent = `${config.label} · ${buckets} buckets`;

    if (!visible.length) {
      el.chart.innerHTML = '<text x="360" y="140" text-anchor="middle" class="chart-label">Enable a percentile to plot it</text>';
      return;
    }

    const W = 720, H = 280;
    const pad = { l: 46, r: 14, t: 16, b: 30 };
    const all = visible.flatMap((s) => s.values);
    const max = Math.ceil(Math.max(...all) / 50) * 50 + 50;
    const x = (i) => pad.l + (i / (buckets - 1)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);

    let svg = '';
    for (let g = 0; g <= 4; g += 1) {
      const value = (max * g) / 4;
      const yy = y(value);
      svg += `<line class="chart__grid" x1="${pad.l}" y1="${yy.toFixed(1)}" x2="${W - pad.r}" y2="${yy.toFixed(1)}" opacity="${g === 0 ? 0.9 : 0.45}"/>`;
      svg += `<text class="chart-label" x="${pad.l - 8}" y="${(yy + 3).toFixed(1)}" text-anchor="end">${Math.round(value)}ms</text>`;
    }
    const labels = tickLabels(buckets);
    const step = Math.max(1, Math.floor(buckets / 6));
    for (let i = 0; i < buckets; i += step) {
      if (i === 0 || i > buckets - step) continue;
      svg += `<text class="chart-label" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${labels[i]}</text>`;
    }

    visible.forEach((s) => {
      const line = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
      svg += `<path d="${line}" fill="none" stroke="${s.colour}" stroke-width="${s.key === 'p95' ? 2.4 : 1.8}" stroke-linejoin="round" stroke-linecap="round" opacity="${s.key === 'p95' ? 1 : 0.75}"/>`;
      const last = s.values.length - 1;
      svg += `<circle cx="${x(last).toFixed(1)}" cy="${y(s.values[last]).toFixed(1)}" r="3" fill="${s.colour}" stroke="#0a0f19" stroke-width="2"/>`;
    });

    el.chart.innerHTML = svg;

    const p95Series = series.find((s) => s.key === 'p95');
    const latest = p95Series.values[p95Series.values.length - 1];
    el.p95.innerHTML = `${latest}<span class="unit">ms</span>`;
    el.rps.textContent = (1100 + Math.round(Math.random() * 400)).toLocaleString();
    el.err.textContent = (0.06 + Math.random() * 0.16).toFixed(2);
  }

  function renderLegend() {
    el.legend.innerHTML = SERIES.map((s) =>
      `<button type="button" data-series="${s.key}" aria-pressed="${!hidden.has(s.key)}" style="color:${s.colour}"><i></i>${s.name}</button>`
    ).join('');
  }

  function renderTables() {
    el.pipeline.innerHTML = PIPELINE.map((row) => `<tr>
      <td>${row.stage}</td>
      <td class="mono dim">${row.workflow}</td>
      <td class="mono">${row.duration}</td>
      <td><span class="status-pill status-pill--ok"><span class="dot" style="background:currentColor"></span>${row.result}</span></td>
      <td class="mono dim">${row.commit}</td>
    </tr>`).join('');

    el.deploys.innerHTML = DEPLOYS.map((d) => `<li class="deploy">
      <div class="deploy__head"><strong>${d.version}</strong><span class="badge">${d.when}</span></div>
      <div class="deploy__meta">${d.note}</div>
    </li>`).join('');

    el.endpoints.innerHTML = ENDPOINTS.map((e) => `<tr>
      <td><span class="method">${e.method}</span></td>
      <td class="mono">${e.path}</td>
      <td class="dim">${e.purpose}</td>
      <td class="num">${e.p95} ms</td>
      <td><span class="status-pill status-pill--ok"><span class="dot" style="background:currentColor"></span>healthy</span></td>
    </tr>`).join('');
  }

  /* ---------------------------------------------------------------- events */
  document.querySelectorAll('[data-window]').forEach((tab) => {
    tab.addEventListener('click', () => {
      windowKey = Number(tab.dataset.window);
      document.querySelectorAll('[data-window]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      drawChart();
    });
  });

  el.legend.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-series]');
    if (!btn) return;
    const key = btn.dataset.series;
    if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
    renderLegend();
    drawChart();
  });

  /* live refresh so the console feels connected */
  setInterval(() => {
    seedTick += 1;
    drawChart();
  }, 5000);

  renderLegend();
  renderTables();
  drawChart();
})();
