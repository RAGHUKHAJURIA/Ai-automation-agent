import { Router, type Router as ExpressRouter } from 'express';
import { checkMongo } from '../infrastructure/mongodb.js';
import { checkRedis } from '../infrastructure/redis.js';
import { isTaskQueueReady } from '../phase1/task-system.js';

export const healthRouter: ExpressRouter = Router();

healthRouter.get('/live', (_request, response) => {
  response.status(200).json({ status: 'ok', service: 'api' });
});

healthRouter.get('/ready', async (_request, response) => {
  const [mongodb, redis] = await Promise.all([checkMongo(), checkRedis()]);
  const queue = isTaskQueueReady();
  const ready = mongodb && redis && queue;
  response.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'unavailable',
    service: 'api',
    dependencies: { mongodb: mongodb ? 'ok' : 'unavailable', redis: redis ? 'ok' : 'unavailable', queue: queue ? 'ok' : 'unavailable' },
  });
});
