import { createServer } from 'node:http';
import { parseServerConfig, type ServerConfig } from '@personal-agent/config/server';
import { createApp } from './app.js';
import { connectMongo, disconnectMongo, initializeIndexes } from './infrastructure/mongodb.js';
import { connectRedis, disconnectRedis } from './infrastructure/redis.js';
import { startOutboxDispatcher, stopOutboxDispatcher } from './phase1/task-system.js';

let config: ServerConfig;
try {
  config = parseServerConfig(process.env);
  if (!config.JWT_ACCESS_SECRET || !config.JWT_REFRESH_SECRET) {
    throw new Error('Invalid server configuration: set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET with `pnpm secrets:generate-dev`');
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Invalid server configuration'}\n`);
  process.exitCode = 1;
  process.exit();
}

const app = createApp(config);
const server = createServer(app);
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
const logLevels = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof logLevels;

function log(level: LogLevel, message: string): void {
  if (logLevels[level] < logLevels[config.LOG_LEVEL]) return;
  const output = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  output.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, message })}\n`);
}

server.on('error', (error: Error) => {
  const errorCode = 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
  log('error', `API startup failed (${errorCode})`);
  process.exitCode = 1;
});

server.listen(config.API_PORT, config.API_HOST, () => {
  log('info', `API listening on port ${config.API_PORT}`);
  void initializeDependencies();
});

async function initializeDependencies(): Promise<void> {
  const results = await Promise.allSettled([
    connectMongo(config.MONGODB_URI),
    connectRedis(config.REDIS_URL),
  ]);
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      const dependency = index === 0 ? 'MongoDB' : 'Redis';
      log('warn', `${dependency} unavailable; readiness will fail until the API restarts`);
    }
  }
  if (results.every((result) => result.status === 'fulfilled')) {
    try {
      await initializeIndexes();
      await startOutboxDispatcher(config);
      log('info', 'Phase 1 database indexes and outbox dispatcher initialized');
    } catch {
      log('error', 'Phase 1 startup initialization failed; readiness must be treated as unavailable');
    }
  }
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', `Received ${signal}; shutting down`);
  const closeHttp = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  const results = await Promise.allSettled([closeHttp, stopOutboxDispatcher(), disconnectMongo(), disconnectRedis()]);
  const failed = results.some((result) => result.status === 'rejected');
  process.exitCode = failed ? 1 : 0;
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
