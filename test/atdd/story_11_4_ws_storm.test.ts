import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer, type Server } from 'node:http';
import { WebSocketStreamHandler } from '../../src/adapters/inbound/websocket-server';
import { StreamDownsampler } from '../../src/domain/services/stream-downsampler';

describe('Story 11.4 [Flow A - ATDD-First]: Telemetry Flood Ingestion Storm Throttling (Invariant AD-27)', () => {
  let server: Server;
  let wsHandler: WebSocketStreamHandler;
  let port: number;

  beforeEach(async () => {
    server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as any).port;
        resolve();
      });
    });

    const downsampler = new StreamDownsampler({ maxOutputHz: 10 });
    wsHandler = new WebSocketStreamHandler(server, downsampler);
    wsHandler.start();
  });

  afterEach(async () => {
    await wsHandler?.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('throttles a 5,000 events/sec storm to <= 10 Hz without dropping peak temperature (89°C)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/telemetry`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const receivedFrames: any[] = [];
    ws.on('message', (data) => {
      receivedFrames.push(JSON.parse(data.toString()));
    });

    const now = 1794185800000;
    // Blast 5,000 events representing a 1-second burst storm across 32 nodes
    for (let i = 0; i < 5000; i++) {
      const nodeIndex = (i % 32) + 1;
      const nodeId = nodeIndex === 32 ? 'server-gpu-01' : `ws-gpu-${String(nodeIndex).padStart(2, '0')}`;
      
      // Inject true peak temperature on node ws-gpu-15
      const isPeakEvent = nodeId === 'ws-gpu-15' && i >= 2000 && i < 2032;
      const temp = isPeakEvent ? 89.0 : 65.0 + (i % 10);
      const vram = isPeakEvent ? 24000000000 : 12000000000;

      wsHandler.broadcastTelemetryEvent({
        node_id: nodeId,
        gpu_index: 0,
        timestamp_ms: now + Math.floor(i / 5), // Spans 1000ms
        temperature_celsius: temp,
        vram_used_bytes: vram,
        vram_total_bytes: 25769803776,
        gpu_utilization_pct: 75.0,
        active_jobs_count: 2,
        current_subject: 'CS-101'
      });
    }

    // Allow window emission to conclude
    await new Promise((r) => setTimeout(r, 1100));
    ws.close();

    // Verification against Invariant AD-27:
    // 1. Must receive at most 10 consolidated frames per second
    expect(receivedFrames.length).toBeGreaterThan(0);
    expect(receivedFrames.length).toBeLessThanOrEqual(10);

    // 2. Peak temperature of 89.0°C on ws-gpu-15 must be accurately preserved in the aggregated frames
    const gpu15Peaks = receivedFrames
      .flatMap((f) => f.nodes || [])
      .filter((n: any) => n.node_id === 'ws-gpu-15')
      .map((n: any) => n.peak_temperature_celsius);

    expect(gpu15Peaks.length).toBeGreaterThan(0);
    const maxSeenTemp = Math.max(...gpu15Peaks);
    expect(maxSeenTemp).toBe(89.0);
  });
});
