import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { ServerConfig } from '@personal-agent/config/server';
import { redisClient } from '../infrastructure/redis.js';
import { InvalidAuthToken, login, owners, readToken, revokeAllSessions, revokeSession, rotateRefresh, type Principal } from './auth.js';
import { originGuard, requireAuth } from './http.js';
import { mongoDatabase } from '../infrastructure/mongodb.js';

const credentialsSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(1_024) }).strict();
function cookie(config: ServerConfig, value: string, maxAge: number): string {
  const secure = config.AUTH_COOKIE_SECURE === 'true' || config.NODE_ENV === 'production' ? '; Secure' : '';
  return `${config.AUTH_COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; SameSite=${config.AUTH_COOKIE_SAME_SITE}; Path=/api/auth; Max-Age=${maxAge}${secure}`;
}
function refreshCookie(request: import('express').Request, config: ServerConfig): string | undefined {
  const header = request.header('cookie');
  const prefix = `${config.AUTH_COOKIE_NAME}=`;
  const entry = header?.split(';').map((value) => value.trim()).find((value) => value.startsWith(prefix));
  if (!entry) return undefined;
  try { return decodeURIComponent(entry.slice(prefix.length)); } catch { return undefined; }
}
async function rateLimit(key: string, maximum: number, windowSeconds: number): Promise<boolean> {
  const redis = redisClient();
  const transaction = redis.multi();
  transaction.incr(key);
  transaction.expire(key, windowSeconds, 'NX');
  const results = await transaction.exec();
  const count = Number(results?.[0]);
  return Number.isFinite(count) && count <= maximum;
}

export function authRouter(config: ServerConfig): Router {
  const router = Router();
  router.post('/login', async (request, response, next) => {
    try {
      const parsed = credentialsSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid login request.', requestId: request.requestId } });
      const address = (request.ip ?? 'unknown').replace(/[^A-Za-z0-9:._-]/g, '').slice(0, 100);
      if (!(await rateLimit(`auth:login:${address}`, config.AUTH_LOGIN_RATE_LIMIT_MAX, config.AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS))) return response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts.', requestId: request.requestId } });
      const result = await login(parsed.data.email, parsed.data.password, config);
      response.setHeader('Set-Cookie', cookie(config, result.refreshToken, config.JWT_REFRESH_TTL_SECONDS));
      response.status(200).json({ accessToken: result.accessToken });
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_CREDENTIALS') {
        await mongoDatabase().collection('audit_events').insertOne({ auditEventId: randomUUID(), ownerId: null, actorType: 'ANONYMOUS', action: 'auth.login.failed', requestId: request.requestId, outcome: 'DENIED', timestamp: new Date(), metadata: { source: 'password' } });
        return response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.', requestId: request.requestId } });
      }
      next(error);
    }
  });

  router.post('/refresh', originGuard(config), async (request, response, next) => {
    const token = refreshCookie(request, config);
    if (!token) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Refresh session is required.', requestId: request.requestId } });
    const address = (request.ip ?? 'unknown').replace(/[^A-Za-z0-9:._-]/g, '').slice(0, 100);
    try {
      if (!(await rateLimit(`auth:refresh:${address}`, config.AUTH_REFRESH_RATE_LIMIT_MAX, config.AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS))) return response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many refresh attempts.', requestId: request.requestId } });
      const result = await rotateRefresh(token, config);
      response.setHeader('Set-Cookie', cookie(config, result.refreshToken, config.JWT_REFRESH_TTL_SECONDS));
      response.status(200).json({ accessToken: result.accessToken });
    } catch (error) {
      if (!(error instanceof InvalidAuthToken)) return next(error);
      await mongoDatabase().collection('audit_events').insertOne({ auditEventId: randomUUID(), ownerId: null, actorType: 'ANONYMOUS', action: 'auth.refresh.failed', requestId: request.requestId, outcome: 'DENIED', timestamp: new Date(), metadata: {} });
      response.setHeader('Set-Cookie', cookie(config, '', 0));
      response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Refresh session is invalid.', requestId: request.requestId } });
    }
  });

  router.post('/logout', originGuard(config), async (request, response, next) => {
    const token = refreshCookie(request, config);
    if (token) {
      let principal: Principal | undefined;
      try {
        const claims = await readToken(token, 'refresh', config);
        principal = { ownerId: String(claims.sub), sessionId: String(claims.sid) };
      } catch {
        response.setHeader('Set-Cookie', cookie(config, '', 0));
        return response.status(204).end();
      }
      try { await revokeSession(principal); } catch (error) { next(error); return; }
    }
    response.setHeader('Set-Cookie', cookie(config, '', 0));
    response.status(204).end();
  });

  router.post('/logout-all', originGuard(config), requireAuth(config), async (request, response, next) => {
    try { await revokeAllSessions(request.principal!.ownerId); response.status(204).end(); } catch (error) { next(error); }
  });

  router.get('/me', requireAuth(config), async (request, response, next) => {
    try {
      const owner = await owners().findOne({ ownerId: request.principal!.ownerId }, { projection: { passwordHash: 0 } });
      if (!owner) return response.status(404).json({ error: { code: 'OWNER_NOT_FOUND', message: 'Owner was not found.', requestId: request.requestId } });
      response.status(200).json({ owner: { ownerId: owner.ownerId, email: owner.normalizedEmail, displayName: owner.displayName } });
    } catch (error) { next(error); }
  });
  return router;
}
