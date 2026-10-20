import { describe, expect, it } from 'vitest';
import { parseServerConfig } from '../src/server.js';

describe('parseServerConfig', () => {
  it('applies safe local development defaults', () => {
    expect(parseServerConfig({}).API_PORT).toBe(3001);
  });

  it('rejects an invalid port without including unrelated secret values', () => {
    expect(() => parseServerConfig({ API_PORT: '70000', PRIVATE_TOKEN: 'must-not-leak' })).toThrow(
      'API_PORT',
    );
    expect(() => parseServerConfig({ API_PORT: '70000', PRIVATE_TOKEN: 'must-not-leak' })).not.toThrow(
      'must-not-leak',
    );
  });

  it('rejects public API bind addresses during the unauthenticated foundation phase', () => {
    expect(() => parseServerConfig({ API_HOST: '0.0.0.0' })).toThrow('API_HOST');
  });

  it('keeps AI optional but requires provider credentials and model when enabled', () => {
    expect(parseServerConfig({}).AI_PROVIDER).toBeUndefined();
    expect(() => parseServerConfig({ AI_PROVIDER: 'openai' })).toThrow('AI_PROVIDER requires AI_API_KEY and AI_MODEL');
    expect(() => parseServerConfig({ AI_PROVIDER: 'openai', AI_API_KEY: 'key', AI_MODEL: 'model', AGENT_MAX_STEPS: '0' })).toThrow('AGENT_MAX_STEPS');
  });

  it('requires strong independent secrets, an explicit HTTPS origin, and secure cookies in production', () => {
    expect(() => parseServerConfig({ NODE_ENV: 'production' })).toThrow('JWT signing secrets');
    const access = 'a'.repeat(64);
    const refresh = 'b'.repeat(64);
    expect(() => parseServerConfig({ NODE_ENV: 'production', JWT_ACCESS_SECRET: access, JWT_REFRESH_SECRET: refresh, WEB_ORIGIN: 'http://agent.example', AUTH_COOKIE_SECURE: 'true' })).toThrow('HTTPS');
    expect(parseServerConfig({ NODE_ENV: 'production', JWT_ACCESS_SECRET: access, JWT_REFRESH_SECRET: refresh, WEB_ORIGIN: 'https://agent.example', AUTH_COOKIE_SECURE: 'true' }).NODE_ENV).toBe('production');
  });
});
