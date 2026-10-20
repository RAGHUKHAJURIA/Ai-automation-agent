import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { parseServerConfig, type ServerConfig } from '@personal-agent/config/server';
import { healthRouter } from './routes/health.js';
import { authRouter } from './phase1/auth-routes.js';
import { approvalRouter, auditRouter, commandRouter, taskRouter, usageRouter } from './phase1/task-system.js';
import { errorHandler, requestContext } from './phase1/http.js';

export function createApp(inputConfig: Pick<ServerConfig, 'WEB_ORIGIN'> & Partial<ServerConfig>) {
  const config = parseServerConfig(inputConfig as NodeJS.ProcessEnv);
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'], credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/health', healthRouter);
  app.use('/api/auth', authRouter(config));
  app.use('/api/commands', commandRouter(config));
  app.use('/api/tasks', taskRouter(config));
  app.use('/api/approvals', approvalRouter(config));
  app.use('/api/audit', auditRouter(config));
  app.use('/api/usage', usageRouter(config));
  app.use((_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
  app.use(errorHandler);
  return app;
}
