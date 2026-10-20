import { createHash, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import type { Collection, Document } from 'mongodb';
import type { ServerConfig } from '@personal-agent/config/server';
import { policyRecordSchema } from '@personal-agent/contracts';
import { mongoDatabase } from '../infrastructure/mongodb.js';

interface Owner extends Document {
  ownerId: string;
  normalizedEmail: string;
  passwordHash: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  authVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

interface AuthSession extends Document {
  sessionId: string;
  ownerId: string;
  refreshIdentifierHash: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revocationReason?: string;
}

export interface Principal { ownerId: string; sessionId: string }
export class InvalidAuthToken extends Error {}
export const owners = (): Collection<Owner> => mongoDatabase().collection<Owner>('owners');
export const sessions = (): Collection<AuthSession> => mongoDatabase().collection<AuthSession>('auth_sessions');
let dummyPasswordHash: Promise<string> | undefined;

function secret(value: string | undefined, label: string): Uint8Array {
  if (!value || Buffer.byteLength(value) < 32) throw new Error(`${label} must contain at least 32 bytes`);
  return new TextEncoder().encode(value);
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 1_024) throw new Error('Password must be 12 to 1024 bytes long');
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try { return await argon2.verify(hash, password); } catch { return false; }
}

export async function createOwner(email: string, password: string, displayName = ''): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) throw new Error('A valid owner email is required');
  const passwordHash = await hashPassword(password);
  const ownerId = randomUUID();
  const now = new Date();
  await owners().insertOne({ ownerId, normalizedEmail, passwordHash, displayName: displayName.trim().slice(0, 120), status: 'ACTIVE', authVersion: 0, createdAt: now, updatedAt: now });
  const baselinePolicy = policyRecordSchema.parse({ policyId: randomUUID(), ownerId, name: 'Phase 1 time tool', enabled: true, priority: 100, effect: 'ALLOW', toolPatterns: ['system.get_time'], createdAt: now, updatedAt: now });
  await mongoDatabase().collection('policies').insertOne(baselinePolicy);
  await mongoDatabase().collection('policies').insertMany(['math.add', 'math.multiply'].map((toolName) => policyRecordSchema.parse({ policyId: randomUUID(), ownerId, name: `Harmless calculation: ${toolName}`, enabled: true, priority: 100, effect: 'ALLOW', toolPatterns: [toolName], createdAt: now, updatedAt: now })));
  return ownerId;
}

function tokenHash(jti: string): string { return createHash('sha256').update(jti).digest('hex'); }

async function issueToken(owner: Owner, sessionId: string, type: 'access' | 'refresh', ttl: number, signingSecret: string | undefined, config: ServerConfig): Promise<{ token: string; jti: string }> {
  const jti = randomUUID();
  const token = await new SignJWT({ type, sid: sessionId, ver: owner.authVersion })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE)
    .setSubject(owner.ownerId).setJti(jti).setIssuedAt().setExpirationTime(`${ttl}s`).sign(secret(signingSecret, 'JWT signing secret'));
  return { token, jti };
}

export async function login(email: string, password: string, config: ServerConfig): Promise<{ accessToken: string; refreshToken: string }> {
  const owner = await owners().findOne({ normalizedEmail: email.trim().toLowerCase() });
  dummyPasswordHash ??= argon2.hash('invalid-login-placeholder', { type: argon2.argon2id });
  const valid = owner ? await verifyPassword(owner.passwordHash, password) : await verifyPassword(await dummyPasswordHash, password);
  if (!owner || !valid || owner.status !== 'ACTIVE') throw new Error('INVALID_CREDENTIALS');
  const sessionId = randomUUID();
  const refresh = await issueToken(owner, sessionId, 'refresh', config.JWT_REFRESH_TTL_SECONDS, config.JWT_REFRESH_SECRET, config);
  const now = new Date();
  await sessions().insertOne({ sessionId, tokenFamilyId: sessionId, ownerId: owner.ownerId, refreshIdentifierHash: tokenHash(refresh.jti), createdAt: now, lastUsedAt: now, expiresAt: new Date(now.getTime() + config.JWT_REFRESH_TTL_SECONDS * 1_000) });
  const access = await issueToken(owner, sessionId, 'access', config.JWT_ACCESS_TTL_SECONDS, config.JWT_ACCESS_SECRET, config);
  await mongoDatabase().collection('audit_events').insertOne({ auditEventId: randomUUID(), ownerId: owner.ownerId, actorType: 'OWNER', actorId: owner.ownerId, sessionId, action: 'auth.login.succeeded', targetType: 'session', targetId: sessionId, outcome: 'SUCCESS', timestamp: now, metadata: {} });
  return { accessToken: access.token, refreshToken: refresh.token };
}

async function verifyToken(token: string, type: 'access' | 'refresh', config: ServerConfig) {
  let result;
  try {
    result = await jwtVerify(token, secret(type === 'access' ? config.JWT_ACCESS_SECRET : config.JWT_REFRESH_SECRET, 'JWT signing secret'), {
      algorithms: ['HS256'], issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('JWT signing secret')) throw error;
    throw new InvalidAuthToken('Invalid authentication token');
  }
  if (result.payload.type !== type || typeof result.payload.sub !== 'string' || typeof result.payload.sid !== 'string' || typeof result.payload.jti !== 'string' || typeof result.payload.ver !== 'number') throw new InvalidAuthToken('Invalid authentication token');
  return result.payload;
}

export async function authenticateAccess(token: string, config: ServerConfig): Promise<Principal> {
  const payload = await verifyToken(token, 'access', config);
  const [session, owner] = await Promise.all([
    sessions().findOne({ sessionId: payload.sid, ownerId: payload.sub, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } }),
    owners().findOne({ ownerId: payload.sub, status: 'ACTIVE', authVersion: payload.ver }),
  ]);
  if (!session || !owner) throw new InvalidAuthToken('Invalid authentication session');
  return { ownerId: owner.ownerId, sessionId: session.sessionId };
}

export async function rotateRefresh(refreshToken: string, config: ServerConfig): Promise<{ accessToken: string; refreshToken: string; principal: Principal }> {
  const payload = await verifyToken(refreshToken, 'refresh', config);
  const session = await sessions().findOne({ sessionId: payload.sid, ownerId: payload.sub });
  if (!session) throw new InvalidAuthToken('Invalid authentication session');
  if (session.revokedAt || session.expiresAt <= new Date()) throw new InvalidAuthToken('Invalid authentication session');
  if (session.refreshIdentifierHash !== tokenHash(payload.jti)) {
    await sessions().updateOne({ sessionId: session.sessionId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), revocationReason: 'refresh_reuse' } });
    await mongoDatabase().collection('audit_events').insertOne({ auditEventId: randomUUID(), ownerId: session.ownerId, actorType: 'SYSTEM', action: 'auth.refresh.failed', targetType: 'session', targetId: session.sessionId, outcome: 'REUSE_DETECTED', timestamp: new Date(), metadata: {} });
    throw new InvalidAuthToken('Invalid authentication session');
  }
  const owner = await owners().findOne({ ownerId: session.ownerId, status: 'ACTIVE', authVersion: payload.ver });
  if (!owner) throw new InvalidAuthToken('Invalid authentication session');
  const refresh = await issueToken(owner, session.sessionId, 'refresh', config.JWT_REFRESH_TTL_SECONDS, config.JWT_REFRESH_SECRET, config);
  const changed = await sessions().updateOne({ sessionId: session.sessionId, refreshIdentifierHash: tokenHash(payload.jti), revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { $set: { refreshIdentifierHash: tokenHash(refresh.jti), lastUsedAt: new Date() } });
  if (!changed.modifiedCount) throw new InvalidAuthToken('Invalid authentication session');
  const access = await issueToken(owner, session.sessionId, 'access', config.JWT_ACCESS_TTL_SECONDS, config.JWT_ACCESS_SECRET, config);
  await mongoDatabase().collection('audit_events').insertOne({ auditEventId: randomUUID(), ownerId: owner.ownerId, actorType: 'OWNER', actorId: owner.ownerId, sessionId: session.sessionId, action: 'auth.refresh.succeeded', targetType: 'session', targetId: session.sessionId, outcome: 'SUCCESS', timestamp: new Date(), metadata: {} });
  return { accessToken: access.token, refreshToken: refresh.token, principal: { ownerId: owner.ownerId, sessionId: session.sessionId } };
}

export async function revokeSession(principal: Principal, reason = 'logout'): Promise<void> {
  await sessions().updateOne({ sessionId: principal.sessionId, ownerId: principal.ownerId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), revocationReason: reason } });
  await mongoDatabase().collection('audit_events').insertOne({ auditEventId: randomUUID(), ownerId: principal.ownerId, actorType: 'OWNER', actorId: principal.ownerId, sessionId: principal.sessionId, action: 'auth.logout', targetType: 'session', targetId: principal.sessionId, outcome: 'SUCCESS', timestamp: new Date(), metadata: {} });
}

export async function revokeAllSessions(ownerId: string): Promise<void> {
  const now = new Date();
  await sessions().updateMany({ ownerId, revokedAt: { $exists: false } }, { $set: { revokedAt: now, revocationReason: 'logout_all' } });
  await owners().updateOne({ ownerId }, { $inc: { authVersion: 1 }, $set: { updatedAt: now } });
  await mongoDatabase().collection('audit_events').insertOne({ auditEventId: randomUUID(), ownerId, actorType: 'OWNER', actorId: ownerId, action: 'auth.sessions.revoked', targetType: 'owner', targetId: ownerId, outcome: 'SUCCESS', timestamp: now, metadata: {} });
}

export async function readToken(token: string, type: 'access' | 'refresh', config: ServerConfig) { return verifyToken(token, type, config); }
