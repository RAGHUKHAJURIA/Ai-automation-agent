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
  GOOGLE_OAUTH_CLIENT_ID: z.preprocess((value) => value === '' ? undefined : value, z.string().min(10).optional()),
  GOOGLE_OAUTH_CLIENT_SECRET: z.preprocess((value) => value === '' ? undefined : value, z.string().min(8).optional()),
  GOOGLE_OAUTH_REDIRECT_URI: z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional()),
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.preprocess((value) => value === '' ? undefined : value, z.string().optional()),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(20).default(8),
  AGENT_MAX_MODEL_CALLS: z.coerce.number().int().min(1).max(20).default(8),
  AGENT_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(20).default(6),
  AGENT_MAX_DURATION_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
  AGENT_MAX_REPEATED_ACTIONS: z.coerce.number().int().min(1).max(5).default(2),
  AGENT_MAX_TOTAL_TOKENS: z.coerce.number().int().min(100).max(100_000).default(8_000),
  AGENT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(8_000).default(1_000),
  DEVICE_PAIRING_TTL_MS: z.coerce.number().int().min(30_000).max(600_000).default(300_000),
  DEVICE_PAIRING_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  DEVICE_AUTH_CHALLENGE_TTL_MS: z.coerce.number().int().min(5_000).max(60_000).default(15_000),
  DEVICE_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(2_000).max(60_000).default(10_000),
  DEVICE_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(180_000).default(35_000),
  WORKER_MAX_MESSAGE_BYTES: z.coerce.number().int().min(1_024).max(1_048_576).default(262_144),
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
  const googleFields = [result.data.GOOGLE_OAUTH_CLIENT_ID, result.data.GOOGLE_OAUTH_CLIENT_SECRET, result.data.GOOGLE_OAUTH_REDIRECT_URI, result.data.GOOGLE_TOKEN_ENCRYPTION_KEY];
  if (googleFields.some(Boolean) && !googleFields.every(Boolean)) throw new Error('Invalid server configuration: Google OAuth requires client ID, client secret, exact redirect URI, and token encryption key');
  if (googleFields.every(Boolean)) {
    const key = Buffer.from(result.data.GOOGLE_TOKEN_ENCRYPTION_KEY!, 'base64');
    if (key.length !== 32 || key.toString('base64') !== result.data.GOOGLE_TOKEN_ENCRYPTION_KEY) throw new Error('Invalid server configuration: GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    const redirect = new URL(result.data.GOOGLE_OAUTH_REDIRECT_URI!);
    if (!redirect.pathname.endsWith('/api/connections/google/callback') || redirect.search || redirect.hash) throw new Error('Invalid server configuration: Google redirect URI must be the fixed callback path');
    if (redirect.protocol !== 'https:' && !(result.data.NODE_ENV !== 'production' && redirect.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(redirect.hostname))) throw new Error('Invalid server configuration: Google redirect URI must use HTTPS (loopback HTTP is development-only)');
  }
  if (result.data.DEVICE_HEARTBEAT_TIMEOUT_MS <= result.data.DEVICE_HEARTBEAT_INTERVAL_MS) {
    throw new Error('Invalid server configuration: DEVICE_HEARTBEAT_TIMEOUT_MS must exceed DEVICE_HEARTBEAT_INTERVAL_MS');
  }

  return result.data;
}
