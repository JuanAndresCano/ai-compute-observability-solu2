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

  /**
   * A sustained storm: an initial burst of 5,000 events (the true 89 C peak is inside it) and then 500 more events right after
   * every frame the client receives (about 5,000 events per second at 10 Hz). The test ends when the DATA says one second has
   * passed (frame timestamps), never on a fixed delay; vitest's test timeout is the only guard against a stream that stops.
   */
  it('throttles a sustained 5,000 events/sec storm to <= 10 frames per second without dropping the 89°C peak', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/telemetry`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const nodeIdAt = (i: number) => (i % 32 === 31 ? 'server-gpu-01' : `ws-gpu-${String((i % 32) + 1).padStart(2, '0')}`);
    const blast = (count: number, withPeak: boolean) => {
      for (let i = 0; i < count; i++) {
        const nodeId = nodeIdAt(i);
        const isPeak = withPeak && nodeId === 'ws-gpu-15' && i >= 2000 && i < 2032;
        wsHandler.broadcastTelemetryEvent({
          node_id: nodeId,
          gpu_index: 0,
          timestamp_ms: 0,
          temperature_celsius: isPeak ? 89.0 : 65.0 + (i % 10), // everything else stays <= 74
          vram_used_bytes: isPeak ? 24_000_000_000 : 12_000_000_000,
          vram_total_bytes: 25_769_803_776,
          gpu_utilization_pct: 75.0,
          active_jobs_count: 2,
          current_subject: 'CS-101',
        });
      }
    };

    const frames: Array<{ timestamp_ms: number; nodes: Array<{ node_id: string; peak_temperature_celsius: number; event_count: number }> }> = [];
    const oneSecondOfStream = new Promise<void>((resolve) => {
      ws.on('message', (data) => {
        const frame = JSON.parse(data.toString());
        frames.push(frame);
        if (frame.timestamp_ms - frames[0]!.timestamp_ms >= 1000) {
          resolve();
        } else {
          blast(500, false); // keep the storm going for as long as the stream is being observed
        }
      });
    });

    blast(5000, true);
    await oneSecondOfStream;
    ws.close();

    // AD-27 (1): never more than 10 frames in any one-second span of the stream (half-open [t, t + 1000) windows)
    expect(frames.length).toBeGreaterThanOrEqual(5); // the stream really was sustained, not a single frame
    for (const frame of frames) {
      const inWindow = frames.filter((f) => f.timestamp_ms >= frame.timestamp_ms && f.timestamp_ms < frame.timestamp_ms + 1000);
      expect(inWindow.length).toBeLessThanOrEqual(10);
    }

    // The storm was consolidated, not forwarded: thousands of raw events per handful of frames
    const rawEventsRepresented = frames.flatMap((f) => f.nodes).reduce((sum, n) => sum + n.event_count, 0);
    expect(rawEventsRepresented).toBeGreaterThanOrEqual(5000);
    expect(rawEventsRepresented / frames.length).toBeGreaterThan(100);

    // AD-27 (2): the true maximum survives aggregation exactly, and no other value is invented above it
    const gpu15Peaks = frames.flatMap((f) => f.nodes).filter((n) => n.node_id === 'ws-gpu-15').map((n) => n.peak_temperature_celsius);
    expect(Math.max(...gpu15Peaks)).toBe(89.0);
    const otherPeaks = frames.flatMap((f) => f.nodes).filter((n) => n.node_id !== 'ws-gpu-15').map((n) => n.peak_temperature_celsius);
    expect(Math.max(...otherPeaks)).toBeLessThanOrEqual(74);
  }, 10_000);
});
