/**
 * Scaffolding & Foundation verification tests for Impl-1.
 * Tests configuration validation, environment parsing, and the health check probe.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig } from '../../src/config';
import { createHttpServer, type HttpServerInstance } from '../../src/adapters/inbound/http-server';
import { createWorld } from '../support/world';

describe('Scaffolding Foundation: Configuration & Health Probe', () => {
  let activeServer: HttpServerInstance | null = null;

  afterEach(async () => {
    if (activeServer) {
      await activeServer.stop();
      activeServer = null;
    }
  });

  describe('Configuration validation (src/config.ts)', () => {
    it('provides sensible defaults when environment is empty', () => {
      const cfg = loadConfig({});
      expect(cfg.port).toBe(8080);
      expect(cfg.host).toBe('0.0.0.0');
      expect(cfg.nodeEnv).toBe('development');
      expect(cfg.dbPath).toBe(':memory:');
      expect(cfg.maxRawQueueCapacity).toBe(10000);
      expect(cfg.decimationWindowMs).toBe(250);
      expect(cfg.logLevel).toBe('info');
    });

    it('parses valid environment variables correctly', () => {
      const cfg = loadConfig({
        PORT: '9090',
        HOST: '127.0.0.1',
        NODE_ENV: 'production',
        DB_PATH: '/tmp/test.db',
        LOG_LEVEL: 'warn',
        MAX_RAW_QUEUE_CAPACITY: '5000',
        DECIMATION_WINDOW_MS: '500',
      });
      expect(cfg.port).toBe(9090);
      expect(cfg.host).toBe('127.0.0.1');
      expect(cfg.nodeEnv).toBe('production');
      expect(cfg.dbPath).toBe('/tmp/test.db');
      expect(cfg.logLevel).toBe('warn');
      expect(cfg.maxRawQueueCapacity).toBe(5000);
      expect(cfg.decimationWindowMs).toBe(500);
    });

    it('rejects invalid PORT values with descriptive error', () => {
      expect(() => loadConfig({ PORT: 'not-a-number' })).toThrow(/Invalid PORT/);
      expect(() => loadConfig({ PORT: '70000' })).toThrow(/Invalid PORT/);
      expect(() => loadConfig({ PORT: '-1' })).toThrow(/Invalid PORT/);
    });
  });

  describe('Health Check Probe (GET /health)', () => {
    it('returns 200 OK with operational telemetry metrics', async () => {
      const world = createWorld();
      const config = loadConfig({ PORT: '0', HOST: '127.0.0.1' });
      activeServer = createHttpServer(world.sut, config);
      await activeServer.start();

      const addr = activeServer.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 8080;

      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');

      const data = (await res.json()) as Record<string, any>;
      expect(data.status).toBe('ok');
      expect(data.service).toBe('ai-infrastructure-observability-console');
      expect(data.registered_nodes).toBe(32);
      expect(data.fleet_gpus).toBe(33);
      expect(data.database).toBe('connected');
    });

    it('returns structured 404 ErrorBodyDTO for unmapped paths', async () => {
      const world = createWorld();
      const config = loadConfig({ PORT: '0', HOST: '127.0.0.1' });
      activeServer = createHttpServer(world.sut, config);
      await activeServer.start();

      const addr = activeServer.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 8080;

      const res = await fetch(`http://127.0.0.1:${port}/unknown-path`);
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, any>;
      expect(data.error_code).toBe('ERR_INVALID_TELEMETRY_PAYLOAD');
      expect(data.http_status).toBe(404);
      expect(data.retryable).toBe(false);
    });
  });

  describe('Story 11.1: Multi-Node Telemetry Ingestion & Real-Time Aggregation', () => {
    it('BDD Scenario: Ingest telemetry batches for all 32 nodes and query cluster summary', async () => {
      const world = createWorld();
      const config = loadConfig({ PORT: '0', HOST: '127.0.0.1' });
      activeServer = createHttpServer(world.sut, config);
      await activeServer.start();

      const addr = activeServer.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 8080;

      // When telemetry batches are ingested for all 32 nodes
      const streamPayload = Array.from({ length: 31 }, (_, i) => ({
        node_id: `ws-gpu-${String(i + 1).padStart(2, '0')}`,
        gpu_util_pct: 60.0,
        mem_used_mb: 12288,
        temp_c: 68.5,
      })).concat([
        {
          node_id: 'server-gpu-01',
          gpu_util_pct: 75.0,
          mem_used_mb: 24576,
          temp_c: 72.0,
        },
      ]);

      const postRes = await fetch(`http://127.0.0.1:${port}/api/v1/metrics/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(streamPayload),
      });

      expect(postRes.status).toBe(200);
      const postResult = (await postRes.json()) as Record<string, any>;
      expect(postResult.accepted_count).toBe(32);
      expect(postResult.dropped_count).toBe(0);

      // And the cluster summary endpoint returns average GPU utilization and total memory consumed
      const summaryRes = await fetch(`http://127.0.0.1:${port}/api/v1/metrics/cluster-summary`);
      expect(summaryRes.status).toBe(200);
      const summary = (await summaryRes.json()) as Record<string, any>;

      expect(summary.active_nodes_count).toBe(32);
      expect(summary.total_nodes_count).toBe(32);
      expect(summary.average_gpu_utilization_pct).toBeGreaterThan(0);
      expect(summary.total_memory_consumed_bytes).toBeGreaterThan(0);
    });
  });

  describe('Story 11.2: Fleet Thermal & Utilization Heatmap Matrix', () => {
    it('BDD Scenario: Fetch cluster heatmap matrix with 32 nodes, temperature bands, and utilization', async () => {
      const world = createWorld();
      const config = loadConfig({ PORT: '0', HOST: '127.0.0.1' });
      activeServer = createHttpServer(world.sut, config);
      await activeServer.start();

      const addr = activeServer.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 8080;

      // Seed telemetry for all 32 nodes with varied temperatures
      const streamPayload = [
        { node_id: 'ws-gpu-01', gpu_util_pct: 40.0, mem_used_mb: 8192, temp_c: 65.0 }, // NORMAL
        { node_id: 'ws-gpu-02', gpu_util_pct: 85.0, mem_used_mb: 16384, temp_c: 78.0 }, // WARM
        { node_id: 'ws-gpu-03', gpu_util_pct: 95.0, mem_used_mb: 20480, temp_c: 88.0 }, // CRITICAL
        ...Array.from({ length: 28 }, (_, i) => ({
          node_id: `ws-gpu-${String(i + 4).padStart(2, '0')}`,
          gpu_util_pct: 50.0,
          mem_used_mb: 10240,
          temp_c: 62.0,
        })),
        { node_id: 'server-gpu-01', gpu_util_pct: 70.0, mem_used_mb: 24576, temp_c: 70.0 },
      ];

      await fetch(`http://127.0.0.1:${port}/api/v1/metrics/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(streamPayload),
      });

      // When the operator queries "/api/v1/metrics/heatmap"
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/metrics/heatmap`);
      expect(res.status).toBe(200);
      const heatmap = (await res.json()) as any[];

      // Then the system returns an array of exactly 32 node items
      expect(heatmap).toHaveLength(32);

      // And each item includes node_id, hostname, temperature_band, and utilization_pct
      const ws01 = heatmap.find((item) => item.node_id === 'ws-gpu-01');
      expect(ws01).toMatchObject({
        node_id: 'ws-gpu-01',
        hostname: 'ws-gpu-01.cluster.local',
        temperature_band: 'NORMAL',
        utilization_pct: 40.0,
      });

      const ws02 = heatmap.find((item) => item.node_id === 'ws-gpu-02');
      expect(ws02.temperature_band).toBe('WARM');

      const ws03 = heatmap.find((item) => item.node_id === 'ws-gpu-03');
      expect(ws03.temperature_band).toBe('CRITICAL');
    });
  });

  describe('Story 11.3: Token Throughput Spike & Latency Alarm', () => {
    it('BDD Scenario: Detect surge breach, trigger alert, and verify in active alerts list', async () => {
      const world = createWorld();
      const config = loadConfig({ PORT: '0', HOST: '127.0.0.1' });
      activeServer = createHttpServer(world.sut, config);
      await activeServer.start();

      const addr = activeServer.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 8080;

      // Evaluate an anomaly rule with surge tokens & latency
      const shortBuckets: Record<number, number> = { 5: 98, 47: 2 };
      const longBuckets: Record<number, number> = { 5: 298, 47: 2 };
      const shortHist = Array.from({ length: 100 }, (_, i) => shortBuckets[i] ?? 0);
      const longHist = Array.from({ length: 100 }, (_, i) => longBuckets[i] ?? 0);

      const evalReq = {
        rule: {
          rule_id: 'TOKEN_SPIKE_AND_LATENCY_BREACH',
          throughput_spike_multiplier: 10.0,
          p99_latency_threshold_ms: 8000.0,
          hysteresis_cycles_required: 3,
        },
        window: {
          short_window_seconds: 30,
          long_window_seconds: 300,
          histogram_bucket_count: 100,
          short_histogram: shortHist,
          long_histogram: longHist,
          short_window_prompt_tokens: 403_200,
          long_window_prompt_tokens: 727_200,
        },
      };

      const evalRes = await fetch(`http://127.0.0.1:${port}/v1/alerts/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(evalReq),
      });

      expect(evalRes.status).toBe(200);
      const evalData = (await evalRes.json()) as Record<string, any>;
      expect(evalData.status).toBe('TRIGGERED');
      expect(evalData.alert_payload).not.toBeNull();
      expect(evalData.alert_payload.severity).toBe('CRITICAL');

      // And the alert is visible in the active alerts list
      const alertsRes = await fetch(`http://127.0.0.1:${port}/api/v1/alerts`);
      expect(alertsRes.status).toBe(200);
      const alertsList = (await alertsRes.json()) as any[];

      expect(alertsList.length).toBeGreaterThanOrEqual(1);
      expect(alertsList[0].status).toBe('TRIGGERED');
      expect(alertsList[0].trigger_rule).toBe('TOKEN_SPIKE_AND_LATENCY_BREACH');
    });
  });
});
