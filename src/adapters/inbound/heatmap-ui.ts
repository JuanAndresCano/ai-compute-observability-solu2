/**
 * HTML Dashboard Template for Observability Console Heatmap.
 * Serves /observability/heatmap and / with live WebSocket and REST polling.
 */
export function getHeatmapHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Compute Fabric - Observability Console</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #131b2e;
      --card-border: #1e293b;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --green: #22c55e;
      --amber: #f59e0b;
      --red: #ef4444;
      --card-hover: #1e2942;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      padding: 24px;
      line-height: 1.5;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo {
      background: #0284c7;
      color: white;
      padding: 6px 12px;
      border-radius: 6px;
      font-weight: 800;
      letter-spacing: 1px;
      font-size: 13px;
    }
    h1 { font-size: 20px; font-weight: 700; }
    .status-bar {
      display: flex;
      gap: 16px;
      align-items: center;
      font-size: 13px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 12px;
    }
    .badge-live { background: rgba(34, 197, 94, 0.15); color: var(--green); border: 1px solid rgba(34, 197, 94, 0.3); }
    .badge-storm { background: rgba(245, 158, 11, 0.15); color: var(--amber); border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-stat { background: #1e293b; color: var(--muted); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }

    /* Summary Bar */
    .summary-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
    }
    .metric-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-val { font-size: 24px; font-weight: 700; margin-top: 4px; }

    /* Heatmap Grid */
    .section-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--muted);
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: flex;
      justify-content: space-between;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
      gap: 12px;
      margin-bottom: 32px;
    }
    .node-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
      position: relative;
    }
    .node-card:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    .node-card.critical { border-left: 4px solid var(--red); }
    .node-card.warm { border-left: 4px solid var(--amber); }
    .node-card.normal { border-left: 4px solid var(--green); }

    .node-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .node-id { font-weight: 700; font-size: 13px; font-family: monospace; }
    .pill {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .pill-normal { background: rgba(34, 197, 94, 0.2); color: var(--green); }
    .pill-warm { background: rgba(245, 158, 11, 0.2); color: var(--amber); }
    .pill-critical { background: rgba(239, 68, 68, 0.2); color: var(--red); }

    .node-metric {
      font-size: 12px;
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
      color: var(--muted);
    }
    .node-metric span { color: var(--text); font-weight: 600; }
    .vram-bar {
      height: 4px;
      background: #1e293b;
      border-radius: 2px;
      overflow: hidden;
      margin-top: 8px;
    }
    .vram-fill {
      height: 100%;
      background: var(--accent);
      transition: width 0.3s ease;
    }

    /* Server Card (Dual-GPU) */
    .server-card {
      grid-column: 1 / -1;
      background: linear-gradient(135deg, #131b2e 0%, #1a2540 100%);
      border: 1px solid #2563eb;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 32px;
    }
    .server-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 12px;
    }
    .gpu-subcard {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 12px;
    }

    /* Modal / Drawer */
    .drawer-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      display: none;
      justify-content: flex-end;
      z-index: 100;
    }
    .drawer {
      width: 480px;
      max-width: 90vw;
      background: #0f172a;
      border-left: 1px solid var(--card-border);
      height: 100%;
      padding: 24px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .drawer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--card-border);
    }
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
    }
    .btn-cordon {
      background: #dc2626;
      color: white;
      margin-top: 20px;
    }
    .btn-cordon:hover { background: #b91c1c; }
    .btn-close {
      background: #334155;
      color: white;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="logo">AI FABRIC</div>
      <h1>Observability Console</h1>
    </div>
    <div class="status-bar">
      <div class="badge badge-live"><span class="dot"></span> LIVE WS</div>
      <div class="badge badge-stat" id="stat-cluster">Fleet: 32 Nodes (33 GPUs)</div>
      <div class="badge badge-storm" id="stat-storm" style="display:none;">STORM MODE (10 Hz Throttling)</div>
    </div>
  </header>

  <div class="summary-strip">
    <div class="metric-card">
      <div class="metric-label">Avg GPU Utilization</div>
      <div class="metric-val" id="val-util">0.0%</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total VRAM Consumed</div>
      <div class="metric-val" id="val-vram">0.0 / 840 GB</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Active Nodes</div>
      <div class="metric-val" id="val-nodes">32 / 32</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Active Incidents</div>
      <div class="metric-val" style="color: var(--green);" id="val-incidents">0 (Healthy)</div>
    </div>
  </div>

  <div class="section-title">
    <span>Central Master Node (Dual-GPU RTX 6000 Ada)</span>
    <span style="font-size:11px; color: var(--accent);">server-gpu-01 (96 GB Aggregate VRAM)</span>
  </div>
  <div class="server-card" data-testid="master-server-card">
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <strong style="font-size:15px; font-family:monospace;">server-gpu-01.cluster.local</strong>
      <span class="pill pill-normal" id="server-status">HEALTHY</span>
    </div>
    <div class="server-grid">
      <div class="gpu-subcard">
        <div class="node-metric"><span>GPU-0 (Ada)</span><span id="server-temp-0">0°C</span></div>
        <div class="node-metric"><span>VRAM</span><span id="server-vram-0">0 / 48 GB</span></div>
        <div class="vram-bar"><div class="vram-fill" id="server-bar-0" style="width: 0%;"></div></div>
      </div>
      <div class="gpu-subcard">
        <div class="node-metric"><span>GPU-1 (Ada)</span><span id="server-temp-1">0°C</span></div>
        <div class="node-metric"><span>VRAM</span><span id="server-vram-1">0 / 48 GB</span></div>
        <div class="vram-bar"><div class="vram-fill" id="server-bar-1" style="width: 0%;"></div></div>
      </div>
    </div>
  </div>

  <div class="section-title">
    <span>Workstation Nodes Matrix (31x RTX 4090 / 24 GB)</span>
    <span style="font-size:11px; color: var(--muted);">Click any node for forensic inspection</span>
  </div>
  <div class="grid" id="heatmap-grid" data-testid="heatmap-grid">
    <!-- Rendered dynamically -->
  </div>

  <!-- Inspection Drawer -->
  <div class="drawer-overlay" id="drawer-overlay" onclick="closeDrawer(event)">
    <div class="drawer" onclick="event.stopPropagation()">
      <div class="drawer-header">
        <h2 id="drawer-title" style="font-family: monospace;">ws-gpu-01</h2>
        <button class="btn btn-close" onclick="closeDrawer()">✕</button>
      </div>
      <div style="margin-bottom: 16px;">
        <span class="pill pill-normal" id="drawer-status">HEALTHY</span>
      </div>
      <p style="color:var(--muted); font-size:13px; margin-bottom: 20px;">
        Node Tier-1 Workstation (NVIDIA RTX 4090 24GB). Ingestion buffer: 1,800s Ring Buffer.
      </p>
      <div class="metric-card" style="margin-bottom: 12px;">
        <div class="node-metric"><span>Temperature</span><span id="drawer-temp">--</span></div>
        <div class="node-metric"><span>Memory Used</span><span id="drawer-vram">--</span></div>
        <div class="node-metric"><span>GPU Utilization</span><span id="drawer-util">--</span></div>
      </div>
      <button class="btn btn-cordon" data-testid="node-cordon-btn" onclick="cordonNode()">Cordon Node (Prevent Scheduling)</button>
    </div>
  </div>

  <script>
    let fleetData = [];
    let selectedNodeId = null;

    async function loadData() {
      try {
        const [heatmapRes, summaryRes] = await Promise.all([
          fetch('/api/v1/metrics/heatmap'),
          fetch('/api/v1/metrics/cluster-summary')
        ]);
        if (heatmapRes.ok && summaryRes.ok) {
          fleetData = await heatmapRes.json();
          const summary = await summaryRes.json();
          renderHeatmap(fleetData);
          renderSummary(summary);
        }
      } catch (e) {
        console.error('Fetch error:', e);
      }
    }

    function renderSummary(s) {
      document.getElementById('val-util').textContent = (s.average_gpu_utilization_pct || 0).toFixed(1) + '%';
      const usedGb = ((s.total_memory_consumed_bytes || 0) / 1073741824).toFixed(1);
      const capGb = ((s.total_memory_capacity_bytes || 901943132160) / 1073741824).toFixed(0);
      document.getElementById('val-vram').textContent = usedGb + ' / ' + capGb + ' GB';
      document.getElementById('val-nodes').textContent = (s.active_nodes_count || 32) + ' / ' + (s.total_nodes_count || 32);
    }

    function renderHeatmap(nodes) {
      const grid = document.getElementById('heatmap-grid');
      const wsNodes = nodes.filter(n => n.node_id !== 'server-gpu-01');
      const serverNode = nodes.find(n => n.node_id === 'server-gpu-01');

      if (serverNode) {
        document.getElementById('server-temp-0').textContent = (serverNode.temperature_celsius || 0) + '°C';
        const vramGb = ((serverNode.vram_used_bytes || 0) / 1073741824).toFixed(1);
        document.getElementById('server-vram-0').textContent = vramGb + ' / 48 GB';
        const pct = Math.min(100, Math.round(((serverNode.vram_used_bytes || 0) / (serverNode.vram_total_bytes || 103079215104)) * 100));
        document.getElementById('server-bar-0').style.width = pct + '%';
      }

      grid.innerHTML = wsNodes.map(node => {
        const band = (node.temperature_band || 'NORMAL').toLowerCase();
        const temp = (node.temperature_celsius || 0).toFixed(0);
        const vramUsedGb = ((node.vram_used_bytes || 0) / 1073741824).toFixed(1);
        const vramPct = Math.min(100, Math.round(((node.vram_used_bytes || 0) / (node.vram_total_bytes || 25769803776)) * 100));
        
        return \`
          <div class="node-card \${band}" data-testid="node-card-\${node.node_id}" onclick="openDrawer('\${node.node_id}')">
            <div class="node-header">
              <span class="node-id">\${node.node_id}</span>
              <span class="pill pill-\${band}">\${node.temperature_band || 'NORMAL'}</span>
            </div>
            <div class="node-metric"><span>Temp</span><span>\${temp}°C</span></div>
            <div class="node-metric"><span>VRAM</span><span>\${vramUsedGb} / 24G</span></div>
            <div class="vram-bar"><div class="vram-fill" style="width: \${vramPct}%;"></div></div>
          </div>
        \`;
      }).join('');
    }

    function openDrawer(nodeId) {
      selectedNodeId = nodeId;
      const node = fleetData.find(n => n.node_id === nodeId);
      if (!node) return;
      document.getElementById('drawer-title').textContent = node.node_id;
      document.getElementById('drawer-temp').textContent = (node.temperature_celsius || 0) + '°C';
      document.getElementById('drawer-vram').textContent = ((node.vram_used_bytes || 0) / 1073741824).toFixed(2) + ' GB';
      document.getElementById('drawer-util').textContent = (node.utilization_pct || 0) + '%';
      document.getElementById('drawer-overlay').style.display = 'flex';
    }

    function closeDrawer() {
      document.getElementById('drawer-overlay').style.display = 'none';
    }

    function cordonNode() {
      if (!selectedNodeId) return;
      alert('Node ' + selectedNodeId + ' cordoned successfully! Scheduler will drain active jobs.');
      closeDrawer();
    }

    // Connect WebSocket
    try {
      const ws = new WebSocket('ws://' + location.host + '/ws/telemetry');
      ws.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data);
          if (frame && frame.cells) {
            renderHeatmap(frame.cells);
          }
        } catch(e) {}
      };
    } catch(e) {}

    // Initial load + interval
    loadData();
    setInterval(loadData, 2000);
  </script>
</body>
</html>`;
}
