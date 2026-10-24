import { parseServerConfig } from '@personal-agent/config/server';
import { connectMongo, disconnectMongo, initializeIndexes } from './infrastructure/mongodb.js';
import { connectRedis, disconnectRedis } from './infrastructure/redis.js';
import { startTaskWorker, stopOutboxDispatcher } from './phase1/task-system.js';
import { startScheduleWorker, stopScheduleWorker } from './phase7/schedules.js';

const config = parseServerConfig(process.env);
let stopping = false;

async function start(): Promise<void> {
  await connectMongo(config.MONGODB_URI);
  await connectRedis(config.REDIS_URL);
  await initializeIndexes();
  const worker = await startTaskWorker(config);
  await startScheduleWorker(config);
  process.stdout.write('Task worker started\n');
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(`Task worker stopping (${signal})\n`);
    await worker.close();
    await stopScheduleWorker();
    await stopOutboxDispatcher();
    await Promise.allSettled([disconnectMongo(), disconnectRedis()]);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch(async () => {
  process.stderr.write('Task worker startup failed; verify MongoDB, Redis, and configuration.\n');
  await Promise.allSettled([disconnectMongo(), disconnectRedis()]);
  process.exitCode = 1;
});
