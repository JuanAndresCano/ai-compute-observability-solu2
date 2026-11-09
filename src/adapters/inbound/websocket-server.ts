/**
 * Inbound WebSocket Server Adapter (Module 11 - Story 11.4).
 * Serves live throttled telemetry streams on /ws/telemetry.
 * Ensures downstream connected browsers receive at most 10 Hz without freezing UI threads.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { StreamDownsampler, type DownsampledFrame } from '../../domain/services/stream-downsampler';

export class WebSocketStreamHandler {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly server: Server,
    private readonly downsampler: StreamDownsampler
  ) {}

  public start(): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({
      server: this.server,
      path: '/ws/telemetry',
    });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });

    // Run 100 ms clock tick (10 Hz)
    this.timer = setInterval(() => {
      this.flushPendingFrame();
    }, 100);
  }

  public broadcastTelemetryEvent(event: {
    node_id: string;
    gpu_index: number;
    timestamp_ms: number;
    temperature_celsius: number;
    vram_used_bytes: number;
    vram_total_bytes?: number;
    gpu_utilization_pct: number;
    active_jobs_count?: number;
    current_subject?: string;
  }): void {
    this.downsampler.ingest({
      node_id: event.node_id,
      gpu_index: event.gpu_index,
      timestamp_ms: event.timestamp_ms,
      temperature_celsius: event.temperature_celsius,
      vram_used_bytes: event.vram_used_bytes,
      gpu_utilization_pct: event.gpu_utilization_pct,
    });
  }

  private flushPendingFrame(): void {
    if (this.clients.size === 0) return;

    const frame = this.downsampler.harvest(Date.now());
    if (!frame) return;

    const payload = JSON.stringify(frame);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    for (const client of this.clients) {
      try {
        client.terminate();
      } catch {
        // Ignore
      }
    }
    this.clients.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }
  }

  public getConnectedClientCount(): number {
    return this.clients.size;
  }
}
