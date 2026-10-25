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
});
