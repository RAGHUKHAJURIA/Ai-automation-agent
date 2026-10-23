import { createHash, createPublicKey, randomBytes, randomInt, randomUUID, scrypt as scryptCallback, timingSafeEqual, verify } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { z } from 'zod';
import type { ServerConfig } from '@personal-agent/config/server';
import { mongoClient, mongoDatabase } from '../infrastructure/mongodb.js';
import { requireAuth } from '../phase1/http.js';
import { disconnectDevice } from './gateway.js';

const scrypt = promisify(scryptCallback);
const createPairingSchema = z.object({}).strict();
const claimSchema = z.object({ pairingRequestId: z.string().uuid(), pairingCode: z.string().regex(/^\d{8}$/), displayName: z.string().trim().min(1).max(64), publicKeyPem: z.string().min(64).max(512), platform: z.enum(['win32', 'darwin', 'linux']), architecture: z.string().min(1).max(32), workerVersion: z.string().min(1).max(64) }).strict();
const completeSchema = z.object({ pairingRequestId: z.string().uuid(), deviceId: z.string().uuid(), ownerId: z.string().uuid(), challengeNonce: z.string().regex(/^[a-f0-9]{64}$/), publicKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/), protocolVersion: z.literal(1), signature: z.string().min(64).max(256), localConfirmed: z.literal(true) }).strict();

async function deriveCodeHash(code: string, salt: Buffer): Promise<Buffer> { return Buffer.from(await scrypt(code, salt, 32) as Buffer); }
function fingerprint(pem: string): string { return createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex'); }

export function deviceRouter(config: ServerConfig): Router {
  const router = Router();
  router.get('/', requireAuth(config), async (request, response, next) => {
    try {
      const devices = await mongoDatabase().collection('devices').find({ ownerId: request.principal!.ownerId }).project({ privateKey: 0 }).sort({ createdAt: -1 }).toArray();
      const now = Date.now();
      response.json({ devices: devices.map((device) => ({ deviceId: device.deviceId, displayName: device.displayName, platform: device.platform, architecture: device.architecture, workerVersion: device.workerVersion, protocolVersion: device.protocolVersion, capabilities: device.capabilities ?? [], revokedAt: device.revokedAt ?? null, lastHeartbeatAt: device.lastHeartbeatAt ?? null, connectionState: device.revokedAt ? 'REVOKED' : device.lastHeartbeatAt && now - new Date(device.lastHeartbeatAt).getTime() <= config.DEVICE_HEARTBEAT_TIMEOUT_MS ? 'ONLINE' : 'OFFLINE' })) });
    } catch (error) { next(error); }
  });

  router.post('/pairing', requireAuth(config), async (request, response, next) => {
    try {
      const parsed = createPairingSchema.safeParse(request.body ?? {});
      if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid pairing request.', requestId: request.requestId } });
      const pairingRequestId = randomUUID();
      const code = randomInt(10_000_000, 100_000_000).toString();
      const salt = randomBytes(16);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + config.DEVICE_PAIRING_TTL_MS);
      await mongoDatabase().collection('pairing_requests').insertOne({ pairingRequestId, ownerId: request.principal!.ownerId, codeSalt: salt.toString('base64'), codeHash: (await deriveCodeHash(code, salt)).toString('base64'), status: 'PENDING', attempts: 0, createdAt: now, expiresAt });
      await audit(request.principal!.ownerId, 'device.pairing.created', pairingRequestId);
      response.status(201).json({ pairingRequestId, code, expiresAt, protocolVersion: 1 });
    } catch (error) { next(error); }
  });

  router.post('/pairing/claim', async (request, response, next) => {
    try {
      const parsed = claimSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid pairing claim.', requestId: request.requestId } });
      const now = new Date();
      const candidate = await mongoDatabase().collection('pairing_requests').findOneAndUpdate({ pairingRequestId: parsed.data.pairingRequestId, status: 'PENDING', expiresAt: { $gt: now }, attempts: { $lt: config.DEVICE_PAIRING_MAX_ATTEMPTS } }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
      if (!candidate) return response.status(401).json({ error: { code: 'PAIRING_REJECTED', message: 'Pairing request is invalid or expired.', requestId: request.requestId } });
      const salt = Buffer.from(String(candidate.codeSalt), 'base64');
      const expected = Buffer.from(String(candidate.codeHash), 'base64');
      const actual = await deriveCodeHash(parsed.data.pairingCode, salt);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        await audit(String(candidate.ownerId), 'device.pairing.failed', String(candidate.pairingRequestId));
        return response.status(401).json({ error: { code: 'PAIRING_REJECTED', message: 'Pairing request is invalid or expired.', requestId: request.requestId } });
      }
      const publicKey = createPublicKeyChecked(parsed.data.publicKeyPem);
      const publicKeyFingerprint = fingerprint(parsed.data.publicKeyPem);
      const deviceId = randomUUID();
      const challengeNonce = randomBytes(32).toString('hex');
      const challengeExpiresAt = new Date(Math.min(new Date(candidate.expiresAt).getTime(), now.getTime() + config.DEVICE_AUTH_CHALLENGE_TTL_MS));
      const claimed = await mongoDatabase().collection('pairing_requests').updateOne({ pairingRequestId: candidate.pairingRequestId, status: 'PENDING', attempts: candidate.attempts }, { $set: { status: 'CLAIMED', deviceId, displayName: parsed.data.displayName, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), publicKeyFingerprint, platform: parsed.data.platform, architecture: parsed.data.architecture, workerVersion: parsed.data.workerVersion, challengeNonce, challengeExpiresAt, claimedAt: now } });
      if (!claimed.modifiedCount) return response.status(409).json({ error: { code: 'PAIRING_CONFLICT', message: 'Pairing request is no longer available.', requestId: request.requestId } });
      response.status(200).json({ pairingRequestId: candidate.pairingRequestId, deviceId, ownerId: candidate.ownerId, ownerLabel: 'Personal Agent owner', backendOrigin: `${request.protocol}://${request.get('host')}`, displayName: parsed.data.displayName, platform: parsed.data.platform, publicKeyFingerprint, challengeNonce, expiresAt: challengeExpiresAt, protocolVersion: 1, requestedCapabilities: ['files.search', 'files.read_text', 'files.write_text', 'files.move'] });
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_PUBLIC_KEY') return response.status(400).json({ error: { code: 'INVALID_PUBLIC_KEY', message: 'Pairing identity is invalid.', requestId: request.requestId } });
      next(error);
    }
  });

  router.post('/pairing/complete', async (request, response, next) => {
    const parsed = completeSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid pairing confirmation.', requestId: request.requestId } });
    const input = parsed.data;
    const collection = mongoDatabase().collection('pairing_requests');
    try {
      const pairing = await collection.findOne({ pairingRequestId: input.pairingRequestId, deviceId: input.deviceId, ownerId: input.ownerId, status: 'CLAIMED', challengeNonce: input.challengeNonce, publicKeyFingerprint: input.publicKeyFingerprint, challengeExpiresAt: { $gt: new Date() } });
      if (!pairing || !verifyPairingSignature(pairing, input)) return response.status(401).json({ error: { code: 'PAIRING_REJECTED', message: 'Pairing confirmation is invalid or expired.', requestId: request.requestId } });
      const now = new Date();
      const client = mongoClient();
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          const owner = await mongoDatabase().collection('owners').findOne({ ownerId: input.ownerId, status: 'ACTIVE' }, { session });
          if (!owner) throw new Error('OWNER_NOT_ACTIVE');
          const consumed = await collection.updateOne({ pairingRequestId: input.pairingRequestId, ownerId: input.ownerId, status: 'CLAIMED', challengeNonce: input.challengeNonce, challengeExpiresAt: { $gt: now } }, { $set: { status: 'CONSUMED', consumedAt: now }, $unset: { codeHash: '', codeSalt: '', challengeNonce: '' } }, { session });
          if (!consumed.modifiedCount) throw new Error('PAIRING_REPLAY');
          await mongoDatabase().collection('devices').insertOne({ deviceId: input.deviceId, ownerId: input.ownerId, displayName: pairing.displayName, platform: pairing.platform, architecture: pairing.architecture, workerVersion: pairing.workerVersion, desktopAppVersion: pairing.workerVersion, protocolVersion: 1, publicKeyPem: pairing.publicKeyPem, publicKeyFingerprint: pairing.publicKeyFingerprint, credentialVersion: 1, capabilities: [], createdAt: now, updatedAt: now, revokedAt: null }, { session });
          await mongoDatabase().collection('audit_events').insertOne({ auditEventId: randomUUID(), ownerId: input.ownerId, actorType: 'OWNER', actorId: input.ownerId, action: 'device.pairing.completed', targetType: 'device', targetId: input.deviceId, outcome: 'SUCCESS', timestamp: now, metadata: { platform: pairing.platform, protocolVersion: 1 } }, { session });
        });
      } finally { await session.endSession(); }
      response.status(201).json({ deviceId: input.deviceId, credentialVersion: 1, protocolVersion: 1 });
    } catch (error) {
      if (error instanceof Error && ['PAIRING_REPLAY', 'OWNER_NOT_ACTIVE'].includes(error.message)) return response.status(409).json({ error: { code: 'PAIRING_REJECTED', message: 'Pairing request is no longer available.', requestId: request.requestId } });
      next(error);
    }
  });

  router.post('/:deviceId/revoke', requireAuth(config), async (request, response, next) => {
    const deviceId = z.string().uuid().safeParse(request.params.deviceId);
    if (!deviceId.success) return response.status(400).json({ error: { code: 'INVALID_DEVICE_ID', message: 'Device identifier is invalid.', requestId: request.requestId } });
    try {
      const now = new Date();
      const result = await mongoDatabase().collection('devices').updateOne({ deviceId: deviceId.data, ownerId: request.principal!.ownerId, revokedAt: null }, { $set: { revokedAt: now, updatedAt: now }, $inc: { credentialVersion: 1 } });
      if (!result.modifiedCount) return response.status(404).json({ error: { code: 'DEVICE_NOT_FOUND', message: 'Device was not found.', requestId: request.requestId } });
      disconnectDevice(deviceId.data, 'REVOKED');
      await audit(request.principal!.ownerId, 'device.revoked', deviceId.data);
      response.status(200).json({ deviceId: deviceId.data, revokedAt: now });
    } catch (error) { next(error); }
  });
  return router;
}

function createPublicKeyChecked(pem: string) {
  try { const key = createPublicKey(pem); if (key.asymmetricKeyType !== 'ed25519') throw new Error(); return key; }
  catch { throw new Error('INVALID_PUBLIC_KEY'); }
}
function verifyPairingSignature(pairing: Record<string, unknown>, input: z.infer<typeof completeSchema>): boolean {
  try {
    const canonical = Buffer.from(JSON.stringify({ version: 1, pairingRequestId: input.pairingRequestId, deviceId: input.deviceId, ownerId: input.ownerId, challengeNonce: input.challengeNonce, publicKeyFingerprint: input.publicKeyFingerprint, protocolVersion: input.protocolVersion }), 'utf8');
    return verify(null, canonical, createPublicKeyChecked(String(pairing.publicKeyPem)), Buffer.from(input.signature, 'base64url'));
  } catch { return false; }
}
async function audit(ownerId: string, action: string, targetId: string): Promise<void> {
  await mongoDatabase().collection('audit_events').insertOne({ auditEventId: randomUUID(), ownerId, actorType: 'OWNER', actorId: ownerId, action, targetType: action.startsWith('device.pairing') ? 'pairing_request' : 'device', targetId, outcome: action.endsWith('.failed') ? 'DENIED' : 'SUCCESS', timestamp: new Date(), metadata: {} });
}
