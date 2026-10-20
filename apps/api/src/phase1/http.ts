import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { ServerConfig } from '@personal-agent/config/server';
import { authenticateAccess, InvalidAuthToken, type Principal } from './auth.js';

declare global { namespace Express { interface Request { requestId: string; principal?: Principal } } }

export function requestContext(request: Request, response: Response, next: NextFunction): void {
  const requestedId = request.header('x-request-id');
  request.requestId = requestedId && /^[A-Za-z0-9._-]{1,100}$/.test(requestedId) ? requestedId : randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
}

export function requireAuth(config: ServerConfig) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.header('authorization');
    if (!authorization?.startsWith('Bearer ')) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.', requestId: request.requestId } });
    try {
      request.principal = await authenticateAccess(authorization.slice(7), config);
      next();
    } catch (error) {
      if (!(error instanceof InvalidAuthToken)) return next(error);
      response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.', requestId: request.requestId } });
    }
  };
}

export function originGuard(config: ServerConfig) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.header('origin') !== config.WEB_ORIGIN) return response.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.', requestId: request.requestId } });
    next();
  };
}

export function errorHandler(_error: unknown, request: Request, response: Response, _next: NextFunction): void {
  process.stderr.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', event: 'request_failed', requestId: request.requestId })}\n`);
  const status = error instanceof Error && error.message === 'INVALID_CREDENTIALS' ? 401 : 500;
  const code = status === 401 ? 'INVALID_CREDENTIALS' : 'INTERNAL_ERROR';
  response.status(status).json({ error: { code, message: status === 401 ? 'Invalid email or password.' : 'An unexpected error occurred.', requestId: request.requestId } });
}
