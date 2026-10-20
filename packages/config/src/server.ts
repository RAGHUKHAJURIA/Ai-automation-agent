import { z } from 'zod';

const serverConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.enum(['127.0.0.1', 'localhost', '::1']).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/personal_agent?replicaSet=rs0'),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.preprocess((value) => value === '' ? undefined : value, z.string().min(32).optional()),
  JWT_REFRESH_SECRET: z.preprocess((value) => value === '' ? undefined : value, z.string().min(32).optional()),
  JWT_ISSUER: z.string().min(1).default('personal-agent'),
  JWT_AUDIENCE: z.string().min(1).default('personal-agent-api'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(300).max(900).default(600),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().min(604_800).max(2_592_000).default(1_209_600),
  AUTH_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('pa_refresh'),
  AUTH_COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  AUTH_COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
  AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(10),
  AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
  AUTH_REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(30),
  BULLMQ_TASK_QUEUE_NAME: z.string().min(1).default('task-execution'),
  BULLMQ_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  OUTBOX_LEASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  TASK_DEFAULT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  AI_PROVIDER: z.preprocess((value) => value === '' ? undefined : value, z.enum(['openai']).optional()),
  AI_MODEL: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).max(128).optional()),
  AI_API_KEY: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(20).default(8),
  AGENT_MAX_MODEL_CALLS: z.coerce.number().int().min(1).max(20).default(8),
  AGENT_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(20).default(6),
  AGENT_MAX_DURATION_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
  AGENT_MAX_REPEATED_ACTIONS: z.coerce.number().int().min(1).max(5).default(2),
  AGENT_MAX_TOTAL_TOKENS: z.coerce.number().int().min(100).max(100_000).default(8_000),
  AGENT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(8_000).default(1_000),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export function parseServerConfig(environment: NodeJS.ProcessEnv): ServerConfig {
  const result = serverConfigSchema.safeParse(environment);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid server configuration: ${issues.join('; ')}`);
  }

  if (result.data.NODE_ENV === 'production') {
    if (!result.data.JWT_ACCESS_SECRET || result.data.JWT_ACCESS_SECRET.length < 64 || !result.data.JWT_REFRESH_SECRET || result.data.JWT_REFRESH_SECRET.length < 64) {
      throw new Error('Invalid server configuration: production requires distinct JWT signing secrets of at least 64 characters');
    }
    if (result.data.JWT_ACCESS_SECRET === result.data.JWT_REFRESH_SECRET) {
      throw new Error('Invalid server configuration: JWT signing secrets must be different');
    }
    if (result.data.AUTH_COOKIE_SECURE !== 'true') {
      throw new Error('Invalid server configuration: production requires AUTH_COOKIE_SECURE=true');
    }
    if (!environment.WEB_ORIGIN) throw new Error('Invalid server configuration: production requires an explicit WEB_ORIGIN');
    if (new URL(result.data.WEB_ORIGIN).protocol !== 'https:') throw new Error('Invalid server configuration: production WEB_ORIGIN must use HTTPS');
    if (result.data.AUTH_COOKIE_SAME_SITE === 'none' && result.data.AUTH_COOKIE_SECURE !== 'true') {
      throw new Error('Invalid server configuration: SameSite=None cookies require secure transport');
    }
  }

  if (result.data.AI_PROVIDER && (!result.data.AI_API_KEY || !result.data.AI_MODEL)) {
    throw new Error('Invalid server configuration: AI_PROVIDER requires AI_API_KEY and AI_MODEL');
  }
  if (result.data.AI_API_KEY && (!result.data.AI_PROVIDER || !result.data.AI_MODEL)) {
    throw new Error('Invalid server configuration: AI_API_KEY requires AI_PROVIDER and AI_MODEL');
  }

  return result.data;
}
