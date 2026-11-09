(() => {
  'use strict';

  const THERMAL_ALERT_C = 88;     // strictly greater than → thermal alert (Story 11.6)
  const WARM_C = 75;
  const POLL_MS = 2000;
  const HISTORY_POINTS = 60;
  const CHART = { w: 320, h: 110, min: 40, max: 110 };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const $ = (id) => document.getElementById(id);
  const grid = $('fleet-grid');
  const drawer = $('node-drawer');
  const cordonButton = $('cordon-button');
  const state = {
    nodes: new Map(),      // id -> latest heatmap row
    cells: new Map(),      // id -> button element
    history: new Map(),    // id -> number[] of temperatures
    cordoned: new Set(),
    selected: null,
    opener: null,
  };

  async function getJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  }

  function cellState(row) {
    if (state.cordoned.has(row.node_id)) return 'cordoned';
    const noData = row.temperature_celsius <= 0 && row.utilization_pct === 0 && row.vram_used_bytes === 0;
    if (noData) return 'nodata';
    if (row.temperature_celsius > THERMAL_ALERT_C) return 'alert';
    if (row.temperature_celsius >= WARM_C) return 'warm';
    return 'normal';
  }

  const TAGS = { normal: 'OK', warm: 'WARM', alert: 'THERMAL ALERT', cordoned: 'CORDONED', nodata: 'NO DATA' };

  function lockIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'lock');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('data-testid', 'lock-icon');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('fill', 'currentColor');
    p.setAttribute('d', 'M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9h-2zM9 7a3 3 0 0 1 6 0v2H9V7z');
    svg.appendChild(p);
    return svg;
  }

  function buildCell(id) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cell';
    btn.dataset.testid = `node-cell-${id}`;
    btn.setAttribute('data-testid', `node-cell-${id}`);
    btn.setAttribute('aria-expanded', 'false');
    btn.append(
      Object.assign(document.createElement('span'), { className: 'id', textContent: id }),
      Object.assign(document.createElement('span'), { className: 'temp' }),
      Object.assign(document.createElement('span'), { className: 'tag' }),
    );
    btn.addEventListener('click', () => openDrawer(id, btn));
    return btn;
  }

  function paintCell(row) {
    const btn = state.cells.get(row.node_id);
    if (!btn) return;
    const s = cellState(row);
    btn.dataset.state = s;
    btn.setAttribute('data-alert', String(s === 'alert'));
    const noData = s === 'nodata';
    btn.querySelector('.temp').textContent = noData ? '—' : `${Math.round(row.temperature_celsius)}°C`;
    const tag = btn.querySelector('.tag');
    tag.replaceChildren();
    if (s === 'cordoned') {
      tag.setAttribute('data-testid', 'cordoned-badge');
      tag.append(lockIcon(), document.createTextNode(TAGS[s]));
    } else {
      tag.removeAttribute('data-testid');
      tag.textContent = TAGS[s];
    }
    // No aria-label: the accessible name is the visible text (node id, temperature, state), satisfying WCAG 2.5.3 Label in Name.
  }

  function renderSummary() {
    let alerts = 0;
    for (const row of state.nodes.values()) if (cellState(row) === 'alert') alerts += 1;
    $('alert-count').textContent = `${alerts} thermal ${alerts === 1 ? 'alert' : 'alerts'}`;
    $('cordoned-count').textContent = `${state.cordoned.size} cordoned`;
  }

  function renderFeed(events) {
    const list = $('activity-feed');
    list.replaceChildren();
    if (events.length === 0) {
      list.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'No operator actions yet.' }));
      return;
    }
    for (const ev of events) {
      const li = document.createElement('li');
      li.setAttribute('data-testid', 'activity-item');
      const node = ev.payload && ev.payload.node_id ? ev.payload.node_id : '';
      const who = ev.payload && ev.payload.cordoned_by ? ev.payload.cordoned_by : 'operator';
      li.textContent = ev.event_type === 'node.cordoned'
        ? `Node ${node} cordoned by ${who}`
        : `${ev.event_type} ${node}`.trim();
      const time = document.createElement('time');
      time.dateTime = new Date(ev.occurred_at_ms).toISOString();
      time.textContent = new Date(ev.occurred_at_ms).toLocaleTimeString();
      li.append(time);
      list.append(li);
    }
  }

  function drawChart(nodeId) {
    const svg = $('telemetry-chart');
    const temps = state.history.get(nodeId) || [];
    svg.replaceChildren();
    svg.setAttribute('data-points', String(temps.length));
    const y = (t) => CHART.h - ((Math.min(Math.max(t, CHART.min), CHART.max) - CHART.min) / (CHART.max - CHART.min)) * CHART.h;
    const thr = document.createElementNS(SVG_NS, 'line');
    thr.setAttribute('class', 'threshold');
    thr.setAttribute('x1', '0'); thr.setAttribute('x2', String(CHART.w));
    thr.setAttribute('y1', String(y(THERMAL_ALERT_C))); thr.setAttribute('y2', String(y(THERMAL_ALERT_C)));
    svg.append(thr);
    if (temps.length === 0) return;
    const step = CHART.w / Math.max(temps.length - 1, 1);
    const pts = temps.map((t, i) => `${(temps.length === 1 ? CHART.w : i * step).toFixed(1)},${y(t).toFixed(1)}`);
    if (temps.length === 1) pts.unshift(`0,${y(temps[0]).toFixed(1)}`);
    const area = document.createElementNS(SVG_NS, 'polygon');
    area.setAttribute('class', 'area');
    area.setAttribute('points', `0,${CHART.h} ${pts.join(' ')} ${CHART.w},${CHART.h}`);
    svg.append(area);
    const line = document.createElementNS(SVG_NS, 'polyline');
    line.setAttribute('class', 'line');
    line.setAttribute('points', pts.join(' '));
    svg.append(line);
    svg.setAttribute('aria-label', `Temperature history, latest ${Math.round(temps[temps.length - 1])} degrees Celsius`);
  }

  function renderDrawer() {
    const id = state.selected;
    if (!id) return;
    const row = state.nodes.get(id);
    $('drawer-node-id').textContent = id;
    if (row) {
      const s = cellState(row);
      $('drawer-status').textContent = TAGS[s];
      $('drawer-temperature').textContent = s === 'nodata' ? '—' : `${Math.round(row.temperature_celsius)}°C`;
      $('drawer-utilization').textContent = `${row.utilization_pct.toFixed(0)}%`;
      const gb = (b) => (b / 1024 ** 3).toFixed(1);
      $('drawer-vram').textContent = `${gb(row.vram_used_bytes)} / ${gb(row.vram_total_bytes)} GB`;
    }
    drawChart(id);
    const isCordoned = state.cordoned.has(id);
    cordonButton.disabled = isCordoned;
    cordonButton.textContent = isCordoned ? 'Node cordoned' : 'Cordon Node from Cluster';
  }

  async function loadLogs(id) {
    const pre = $('drawer-logs');
    pre.textContent = 'Loading…';
    try {
      const { lines } = await getJson(`/v1/nodes/${encodeURIComponent(id)}/logs`);
      if (state.selected !== id) return;
      pre.textContent = lines.length ? lines.join('\n') : 'No recent error logs for this node.';
    } catch {
      if (state.selected === id) pre.textContent = 'Could not load logs.';
    }
  }

  function openDrawer(id, opener) {
    if (state.selected && state.cells.get(state.selected)) state.cells.get(state.selected).setAttribute('aria-expanded', 'false');
    state.selected = id;
    state.opener = opener;
    opener.setAttribute('aria-expanded', 'true');
    $('drawer-error').hidden = true;
    drawer.classList.add('open');
    drawer.removeAttribute('inert');
    drawer.setAttribute('aria-hidden', 'false');
    renderDrawer();
    loadLogs(id);
    $('drawer-close').focus();
  }

  function closeDrawer() {
    if (!state.selected) return;
    state.cells.get(state.selected)?.setAttribute('aria-expanded', 'false');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('inert', '');
    const opener = state.opener;
    state.selected = null;
    state.opener = null;
    if (opener) opener.focus();
  }

  async function cordonSelected() {
    const id = state.selected;
    if (!id) return;
    const err = $('drawer-error');
    err.hidden = true;
    cordonButton.disabled = true;
    try {
      const res = await fetch(`/v1/nodes/${encodeURIComponent(id)}/cordon`, { method: 'POST', headers: { 'X-Operator': 'liam' } });
      if (!res.ok) throw new Error(`cordon failed (${res.status})`);
      state.cordoned.add(id);
      const row = state.nodes.get(id);
      if (row) paintCell(row);
      renderSummary();
      renderDrawer();
      const { events } = await getJson('/v1/audit-events?limit=20&type_prefix=node.');
      renderFeed(events);
    } catch (e) {
      err.textContent = `Could not cordon ${id}. ${e.message}`;
      err.hidden = false;
      cordonButton.disabled = false;
    }
  }

  function applyHeatmap(rows) {
    if (state.cells.size === 0) {
      grid.replaceChildren();
      for (const row of rows) {
        const cell = buildCell(row.node_id);
        state.cells.set(row.node_id, cell);
        grid.append(cell);
      }
    }
    for (const row of rows) {
      state.nodes.set(row.node_id, row);
      const h = state.history.get(row.node_id) || [];
      h.push(row.temperature_celsius);
      if (h.length > HISTORY_POINTS) h.shift();
      state.history.set(row.node_id, h);
      paintCell(row);
    }
    renderSummary();
    renderDrawer();
  }

  async function refresh() {
    try {
      const [rows, cordoned, feed] = await Promise.all([
        getJson('/api/v1/metrics/heatmap'),
        getJson('/v1/nodes/cordoned'),
        getJson('/v1/audit-events?limit=20&type_prefix=node.'),
      ]);
      state.cordoned = new Set(cordoned.node_ids);
      applyHeatmap(rows);
      renderFeed(feed.events);
      $('connection-banner').hidden = true;
    } catch {
      $('connection-banner').hidden = false;
    }
  }

  $('drawer-close').addEventListener('click', closeDrawer);
  cordonButton.addEventListener('click', cordonSelected);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  refresh();
  setInterval(refresh, POLL_MS);
})();
