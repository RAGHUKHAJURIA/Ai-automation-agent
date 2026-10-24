import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { parseServerConfig, type ServerConfig } from '@personal-agent/config/server';
import { healthRouter } from './routes/health.js';
import { authRouter } from './phase1/auth-routes.js';
import { approvalRouter, auditRouter, commandRouter, taskRouter, usageRouter } from './phase1/task-system.js';
import { errorHandler, requestContext } from './phase1/http.js';
import { deviceRouter } from './phase3/devices.js';
import { googleConnectionRouter } from './phase7/google-connections.js';
import { schedulesRouter } from './phase7/schedules.js';
import { phase7PolicyRouter } from './phase7/policies.js';

export function createApp(inputConfig: Pick<ServerConfig, 'WEB_ORIGIN'> & Partial<ServerConfig>): Express {
  const config = parseServerConfig(inputConfig as unknown as NodeJS.ProcessEnv);
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'], credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/health', healthRouter);
  app.use('/api/auth', authRouter(config));
  app.use('/api/commands', commandRouter(config));
  app.use('/api/tasks', taskRouter(config));
  app.use('/api/approvals', approvalRouter(config));
  app.use('/api/audit', auditRouter(config));
  app.use('/api/usage', usageRouter(config));
  app.use('/api/devices', deviceRouter(config));
  app.use('/api/connections', googleConnectionRouter(config));
  app.use('/api/schedules', schedulesRouter(config));
  app.use('/api/phase7/permissions', phase7PolicyRouter(config));
  app.use((_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
  app.use(errorHandler);
  return app;
}
