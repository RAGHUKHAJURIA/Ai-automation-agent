import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { google } from 'googleapis';
import { CodeChallengeMethod, type OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import type { ServerConfig } from '@personal-agent/config/server';
import { mongoDatabase } from '../infrastructure/mongodb.js';
import { originGuard, requireAuth } from '../phase1/http.js';
import {
  capabilitiesFor,
  decryptSecret,
  encryptSecret,
  googleScopes,
  randomToken,
  requestedCapabilitiesSchema,
  scopesFor,
  sha256,
  type EncryptedSecret,
} from './google-security.js';

const connections = () => mongoDatabase().collection('connections');
const attempts = () => mongoDatabase().collection('oauth_attempts');
const accessCache = new Map<string, { token: string; expiresAt: number }>();

export function googleConfigured(config: ServerConfig): boolean {
  return Boolean(
    config.GOOGLE_OAUTH_CLIENT_ID &&
    config.GOOGLE_OAUTH_CLIENT_SECRET &&
    config.GOOGLE_OAUTH_REDIRECT_URI &&
    config.GOOGLE_TOKEN_ENCRYPTION_KEY,
  );
}

function oauthClient(config: ServerConfig) {
  if (!googleConfigured(config)) throw new Error('GOOGLE_NOT_CONFIGURED');
  return new google.auth.OAuth2(
    config.GOOGLE_OAUTH_CLIENT_ID!,
    config.GOOGLE_OAUTH_CLIENT_SECRET!,
    config.GOOGLE_OAUTH_REDIRECT_URI!,
  );
}

function cookieValue(raw: string | undefined, name: string): string | null {
  const found = raw
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : null;
}

export async function getGoogleClient(
  config: ServerConfig,
  ownerId: string,
  connectionId: string,
  requiredScope: string,
): Promise<OAuth2Client> {
  if (!googleConfigured(config)) throw new Error('GOOGLE_NOT_CONFIGURED');
  const connection = await connections().findOne({
    connectionId,
    ownerId,
    provider: 'GOOGLE',
    status: 'CONNECTED',
    revokedAt: null,
  });
  if (!connection) throw new Error('GOOGLE_CONNECTION_UNAVAILABLE');
  if (
    !Array.isArray(connection.grantedScopes) ||
    (!connection.grantedScopes.includes(requiredScope) &&
      !(
        requiredScope === googleScopes.calendarRead &&
        connection.grantedScopes.includes(googleScopes.calendarWrite)
      ))
  )
    throw new Error('GOOGLE_SCOPE_DENIED');
  const refreshToken = decryptSecret(
    connection.encryptedRefreshToken as EncryptedSecret,
    config.GOOGLE_TOKEN_ENCRYPTION_KEY!,
    `${ownerId}:${connectionId}`,
  );
  const client = oauthClient(config);
  const cached = accessCache.get(connectionId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    client.setCredentials({
      access_token: cached.token,
      refresh_token: refreshToken,
      expiry_date: cached.expiresAt,
    });
    return client;
  }
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) throw new Error('GOOGLE_ACCESS_TOKEN_MISSING');
    const currentRefresh = credentials.refresh_token || refreshToken;
    client.setCredentials({ ...credentials, refresh_token: currentRefresh });
    if (credentials.refresh_token) {
      await connections().updateOne(
        { connectionId, ownerId, status: 'CONNECTED' },
        {
          $set: {
            encryptedRefreshToken: encryptSecret(
              credentials.refresh_token,
              config.GOOGLE_TOKEN_ENCRYPTION_KEY!,
              `${ownerId}:${connectionId}`,
            ),
            updatedAt: new Date(),
          },
        },
      );
    }
    accessCache.set(connectionId, {
      token: credentials.access_token,
      expiresAt: credentials.expiry_date ?? Date.now() + 3_000_000,
    });
    await connections().updateOne(
      { connectionId, ownerId, status: 'CONNECTED' },
      { $set: { lastHealthyAt: new Date(), updatedAt: new Date() } },
    );
    return client;
  } catch (error) {
    if (error instanceof Error && /invalid_grant|unauthorized_client/i.test(error.message)) {
      accessCache.delete(connectionId);
      await connections().updateOne(
        { connectionId, ownerId, status: 'CONNECTED' },
        {
          $set: {
            status: 'REAUTH_REQUIRED',
            updatedAt: new Date(),
            lastError: 'CREDENTIAL_REJECTED',
          },
        },
      );
      throw new Error('GOOGLE_REAUTH_REQUIRED');
    }
    throw new Error('GOOGLE_REFRESH_FAILED');
  }
}

export function googleConnectionRouter(config: ServerConfig): Router {
  const router = Router();
  router.get('/google/callback', async (request, response, next) => {
    const query = z
      .object({
        state: z.string().min(32).max(128),
        code: z.string().min(1).max(4096).optional(),
        error: z.string().max(128).optional(),
      })
      .passthrough()
      .safeParse(request.query);
    const browserNonce = cookieValue(request.header('cookie'), 'pa_google_oauth');
    response.clearCookie('pa_google_oauth', { path: '/api/connections/google/callback' });
    if (!query.success || !browserNonce)
      return response.status(400).json({ error: { code: 'OAUTH_STATE_INVALID' } });
    try {
      const attempt = await attempts().findOneAndUpdate(
        {
          stateHash: sha256(query.data.state),
          browserNonceHash: sha256(browserNonce),
          provider: 'GOOGLE',
          consumedAt: null,
          expiresAt: { $gt: new Date() },
        },
        { $set: { consumedAt: new Date() } },
        { returnDocument: 'before' },
      );
      if (!attempt) return response.status(400).json({ error: { code: 'OAUTH_STATE_INVALID' } });
      if (query.data.error || !query.data.code)
        return response.status(400).json({ error: { code: 'OAUTH_DENIED' } });
      if (!googleConfigured(config))
        return response.status(503).json({ error: { code: 'GOOGLE_NOT_CONFIGURED' } });
      const client = oauthClient(config);
      const codeVerifier = decryptSecret(
        attempt.encryptedCodeVerifier as EncryptedSecret,
        config.GOOGLE_TOKEN_ENCRYPTION_KEY!,
        String(attempt.attemptId),
      );
      const { tokens } = await client.getToken({ code: query.data.code, codeVerifier });
      if (!tokens.access_token) throw new Error('OAUTH_ACCESS_TOKEN_MISSING');
      client.setCredentials(tokens);
      const tokenInfo = await client.getTokenInfo(tokens.access_token);
      const grantedScopes = tokenInfo.scopes ?? [];
      const identity = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
      const accountEmail = identity.data.email?.toLowerCase();
      if (!accountEmail || !identity.data.id) throw new Error('GOOGLE_ACCOUNT_IDENTITY_MISSING');
      const prior = await connections().findOne({
        ownerId: attempt.ownerId,
        provider: 'GOOGLE',
        providerAccountId: identity.data.id,
      });
      const connectionId = prior ? String(prior.connectionId) : randomUUID();
      const refreshToken =
        tokens.refresh_token ??
        (prior?.encryptedRefreshToken
          ? decryptSecret(
              prior.encryptedRefreshToken as EncryptedSecret,
              config.GOOGLE_TOKEN_ENCRYPTION_KEY!,
              `${attempt.ownerId}:${connectionId}`,
            )
          : null);
      if (!refreshToken)
        return response.status(409).json({
          error: {
            code: 'OAUTH_REFRESH_TOKEN_MISSING',
            message: 'Reconnect with offline consent.',
          },
        });
      const now = new Date();
      await connections().updateOne(
        { connectionId, ownerId: attempt.ownerId },
        {
          $set: {
            provider: 'GOOGLE',
            providerAccountId: identity.data.id,
            displayEmail: accountEmail,
            status: 'CONNECTED',
            grantedScopes,
            capabilities: capabilitiesFor(grantedScopes),
            encryptedRefreshToken: encryptSecret(
              refreshToken,
              config.GOOGLE_TOKEN_ENCRYPTION_KEY!,
              `${attempt.ownerId}:${connectionId}`,
            ),
            updatedAt: now,
            lastHealthyAt: now,
            revokedAt: null,
            lastError: null,
          },
          $setOnInsert: { connectionId, ownerId: attempt.ownerId, createdAt: now },
        },
        { upsert: true },
      );
      accessCache.delete(connectionId);
      await mongoDatabase()
        .collection('audit_events')
        .insertOne({
          auditEventId: randomUUID(),
          ownerId: attempt.ownerId,
          actorType: 'OWNER',
          actorId: attempt.ownerId,
          action: 'connection.oauth.completed',
          targetType: 'connection',
          targetId: connectionId,
          outcome: 'CONNECTED',
          timestamp: now,
          metadata: { provider: 'GOOGLE', capabilityCount: capabilitiesFor(grantedScopes).length },
        });
      return response.redirect(303, `${config.WEB_ORIGIN}/?connection=google-connected`);
    } catch (error) {
      next(error);
    }
  });
  router.use(requireAuth(config));
  router.get('/', async (request, response, next) => {
    try {
      const rows = await connections()
        .find({ ownerId: request.principal!.ownerId })
        .project({
          _id: 0,
          connectionId: 1,
          provider: 1,
          displayEmail: 1,
          status: 1,
          grantedScopes: 1,
          capabilities: 1,
          createdAt: 1,
          updatedAt: 1,
          lastHealthyAt: 1,
          lastError: 1,
          revokedAt: 1,
        })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();
      response.json({ configured: googleConfigured(config), connections: rows });
    } catch (error) {
      next(error);
    }
  });
  router.post('/:provider/start', originGuard(config), async (request, response, next) => {
    if (request.params.provider !== 'google')
      return response.status(404).json({ error: { code: 'PROVIDER_UNSUPPORTED' } });
    if (!googleConfigured(config))
      return response.status(503).json({ error: { code: 'GOOGLE_NOT_CONFIGURED' } });
    const parsed = requestedCapabilitiesSchema.safeParse(request.body);
    if (!parsed.success)
      return response.status(400).json({ error: { code: 'INVALID_CAPABILITIES' } });
    try {
      const state = randomToken();
      const browserNonce = randomToken();
      const codeVerifier = randomToken();
      const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
      const attemptId = randomUUID();
      const now = new Date();
      await attempts().insertOne({
        attemptId,
        provider: 'GOOGLE',
        ownerId: request.principal!.ownerId,
        sessionId: request.principal!.sessionId,
        stateHash: sha256(state),
        browserNonceHash: sha256(browserNonce),
        encryptedCodeVerifier: encryptSecret(
          codeVerifier,
          config.GOOGLE_TOKEN_ENCRYPTION_KEY!,
          attemptId,
        ),
        requestedScopes: scopesFor(parsed.data.capabilities),
        createdAt: now,
        expiresAt: new Date(now.getTime() + 10 * 60_000),
        consumedAt: null,
      });
      response.cookie('pa_google_oauth', browserNonce, {
        httpOnly: true,
        secure: new URL(config.GOOGLE_OAUTH_REDIRECT_URI!).protocol === 'https:',
        sameSite: 'lax',
        maxAge: 10 * 60_000,
        path: '/api/connections/google/callback',
      });
      const authorizationUrl = oauthClient(config).generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopesFor(parsed.data.capabilities),
        include_granted_scopes: true,
        state,
        code_challenge: challenge,
        code_challenge_method: CodeChallengeMethod.S256,
      });
      await mongoDatabase()
        .collection('audit_events')
        .insertOne({
          auditEventId: randomUUID(),
          ownerId: request.principal!.ownerId,
          actorType: 'OWNER',
          actorId: request.principal!.ownerId,
          action: 'connection.oauth.started',
          targetType: 'oauth_attempt',
          targetId: attemptId,
          outcome: 'STARTED',
          timestamp: now,
          metadata: { provider: 'GOOGLE' },
        });
      response
        .status(200)
        .json({ authorizationUrl, expiresAt: new Date(now.getTime() + 10 * 60_000) });
    } catch (error) {
      next(error);
    }
  });
  router.post('/:id/revoke', originGuard(config), async (request, response, next) => {
    try {
      const ownerId = request.principal!.ownerId;
      const connectionId = request.params.id;
      if (typeof connectionId !== 'string')
        return response.status(400).json({ error: { code: 'INVALID_CONNECTION_ID' } });
      const prior = await connections().findOneAndUpdate(
        { connectionId, ownerId, provider: 'GOOGLE', status: { $ne: 'REVOKED' } },
        {
          $set: { status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() },
          $unset: { encryptedRefreshToken: '' },
        },
        { returnDocument: 'before' },
      );
      if (!prior) return response.status(404).json({ error: { code: 'CONNECTION_NOT_FOUND' } });
      accessCache.delete(connectionId);
      let providerRevoked = false;
      if (googleConfigured(config) && prior.encryptedRefreshToken) {
        try {
          const refresh = decryptSecret(
            prior.encryptedRefreshToken as EncryptedSecret,
            config.GOOGLE_TOKEN_ENCRYPTION_KEY!,
            `${ownerId}:${connectionId}`,
          );
          await oauthClient(config).revokeToken(refresh);
          providerRevoked = true;
        } catch {
          /* Local revocation is authoritative even if Google is unavailable. */
        }
      }
      await mongoDatabase().collection('audit_events').insertOne({
        auditEventId: randomUUID(),
        ownerId,
        actorType: 'OWNER',
        actorId: ownerId,
        action: 'connection.revoked',
        targetType: 'connection',
        targetId: connectionId,
        outcome: 'REVOKED',
        timestamp: new Date(),
        metadata: { providerRevoked },
      });
      response.json({ connectionId, status: 'REVOKED', providerRevoked });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
