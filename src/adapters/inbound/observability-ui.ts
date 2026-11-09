/**
 * Inbound adapter for the Observability Console web view (Story 11.6, Flow E) and its triage endpoints.
 * Kept separate from http-server.ts so the main router only delegates; no transport type leaks inward.
 *
 *   GET  /observability/heatmap            fleet thermal heatmap page
 *   GET  /observability/assets/<file>      its CSS / JS (whitelisted, no path traversal)
 *   GET  /v1/nodes/cordoned                ids of cordoned nodes
 *   POST /v1/nodes/:node_id/cordon         isolate a node, emits `node.cordoned` audit event
 *   GET  /v1/nodes/:node_id/logs           recent stderr / syslog lines (drawer)
 *   GET  /v1/audit-events                  activity feed, newest first
 *   GET  /v1/incidents                     active composite incidents (Story 11.5, AD-28)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { System } from '../../composition';

const UI_DIR = join(__dirname, 'ui');

const STATIC_ROUTES: Readonly<Record<string, { file: string; type: string }>> = {
  '/observability/heatmap': { file: 'heatmap.html', type: 'text/html; charset=utf-8' },
  '/observability/assets/heatmap.css': { file: 'heatmap.css', type: 'text/css; charset=utf-8' },
  '/observability/assets/heatmap.js': { file: 'heatmap.js', type: 'text/javascript; charset=utf-8' },
};

const NODE_ID_SEGMENT = /^[A-Za-z0-9-]{1,40}$/;
const MAX_FEED = 200;

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

const sendJson = (res: ServerResponse, status: number, payload: unknown): void =>
  send(res, status, 'application/json', JSON.stringify(payload));

/** Returns true when the request was handled here; false lets the main router continue. */
export async function handleObservabilityRoute(
  system: System,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const { pathname } = url;
  const method = req.method?.toUpperCase() ?? 'GET';

  const asset = STATIC_ROUTES[pathname];
  if (asset && method === 'GET') {
    send(res, 200, asset.type, readFileSync(join(UI_DIR, asset.file), 'utf8'));
    return true;
  }

  if (pathname === '/v1/nodes/cordoned' && method === 'GET') {
    sendJson(res, 200, { node_ids: system.cordon.listCordonedNodeIds() });
    return true;
  }

  if ((pathname === '/v1/incidents' || pathname === '/api/v1/incidents') && method === 'GET') {
    sendJson(res, 200, { incidents: system.incidents.listActiveIncidents() });
    return true;
  }

  if (pathname === '/v1/audit-events' && method === 'GET') {
    const requested = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(Math.max(Number.isNaN(requested) ? 50 : requested, 1), MAX_FEED);
    const prefix = url.searchParams.get('type_prefix') ?? undefined;
    const events = system.auditTrail.recent(limit, prefix).map((e) => ({
      event_type: e.eventType,
      occurred_at_ms: e.occurredAtMs,
      payload: e.payload,
    }));
    sendJson(res, 200, { events });
    return true;
  }

  const nodeMatch = pathname.match(/^\/v1\/nodes\/([^/]+)\/(cordon|logs)$/);
  if (nodeMatch) {
    const nodeId = decodeURIComponent(nodeMatch[1]!);
    if (!NODE_ID_SEGMENT.test(nodeId)) return false;

    if (nodeMatch[2] === 'cordon' && method === 'POST') {
      const operator = String(req.headers['x-operator'] ?? 'liam').slice(0, 64);
      sendJson(res, 200, await system.cordon.cordonNode(nodeId, operator));
      return true;
    }
    if (nodeMatch[2] === 'logs' && method === 'GET') {
      const lines = await system.logs.tail(nodeId, 50);
      sendJson(res, 200, { node_id: nodeId, lines });
      return true;
    }
  }

  return false;
}
