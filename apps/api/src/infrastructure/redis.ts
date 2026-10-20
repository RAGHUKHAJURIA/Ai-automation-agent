import { createClient, type RedisClientType } from 'redis';

let client: RedisClientType | undefined;

export function redisClient(): RedisClientType {
  if (!client?.isReady) throw new Error('Redis is not connected');
  return client;
}

export async function connectRedis(url: string): Promise<void> {
  const redisClient = (client ??= createClient({ url }));
  redisClient.on('error', () => {
    process.stderr.write('Redis client error\n');
  });
  try {
    if (!redisClient.isOpen) await redisClient.connect();
    await redisClient.ping();
  } catch {
    if (redisClient.isOpen) redisClient.destroy();
    client = undefined;
    throw new Error('Redis connection failed');
  }
}

export async function checkRedis(): Promise<boolean> {
  const redisClient = client;
  if (!redisClient?.isReady) return false;
  try {
    await redisClient.ping();
    return true;
  } catch {
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  const redisClient = client;
  if (!redisClient) return;
  client = undefined;
  if (!redisClient.isOpen) return;
  try {
    await redisClient.quit();
  } catch (error) {
    redisClient.destroy();
    throw error;
  }
}
