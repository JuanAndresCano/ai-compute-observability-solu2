/**
 * Application Configuration Management & Environment Validation.
 * Adheres to 12-factor application design and Ports & Adapters separation.
 */

export interface AppConfig {
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly host: string;
  readonly port: number;
  readonly dbPath: string;
  readonly maxRawQueueCapacity: number;
  readonly decimationWindowMs: number;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Demo/E2E only: pre-load scripted kernel log lines for ws-gpu-22 so the triage drawer has evidence to show. */
  readonly seedDemoLogs?: boolean;
}

function parsePort(val: string | undefined, defaultPort = 8080): number {
  if (!val) return defaultPort;
  const p = Number.parseInt(val, 10);
  if (Number.isNaN(p) || p < 0 || p > 65535) {
    throw new Error(`Invalid PORT configuration: "${val}". Port must be an integer between 0 and 65535.`);
  }
  return p;
}

function parseNodeEnv(val: string | undefined): 'development' | 'production' | 'test' {
  if (!val) return 'development';
  if (val === 'production' || val === 'test' || val === 'development') {
    return val;
  }
  return 'development';
}

function parseLogLevel(val: string | undefined): 'debug' | 'info' | 'warn' | 'error' {
  if (val === 'debug' || val === 'info' || val === 'warn' || val === 'error') {
    return val;
  }
  return 'info';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    nodeEnv: parseNodeEnv(env.NODE_ENV),
    host: env.HOST?.trim() || '0.0.0.0',
    port: parsePort(env.PORT, 8080),
    dbPath: env.DB_PATH?.trim() || ':memory:',
    maxRawQueueCapacity: Number.parseInt(env.MAX_RAW_QUEUE_CAPACITY || '10000', 10),
    decimationWindowMs: Number.parseInt(env.DECIMATION_WINDOW_MS || '250', 10),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    seedDemoLogs: env.SEED_DEMO_LOGS === 'true',
  };
}
