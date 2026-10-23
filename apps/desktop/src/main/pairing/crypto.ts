import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

export interface GeneratedIdentity { deviceId: string; privateKeyPem: string; publicKeyPem: string; credentialVersion: number }
export function generateDeviceIdentity(): GeneratedIdentity {
  const keys = generateKeyPairSync('ed25519');
  return { deviceId: randomUUID(), privateKeyPem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), credentialVersion: 1 };
}

export function canonicalPairingPayload(value: { pairingRequestId: string; deviceId: string; ownerId: string; challengeNonce: string; publicKeyFingerprint: string; protocolVersion: number }): Buffer {
  return Buffer.from(JSON.stringify({ version: 1, pairingRequestId: value.pairingRequestId, deviceId: value.deviceId, ownerId: value.ownerId, challengeNonce: value.challengeNonce, publicKeyFingerprint: value.publicKeyFingerprint, protocolVersion: value.protocolVersion }), 'utf8');
}
export function canonicalWorkerPayload(value: { challengeNonce: string; connectionId: string; deviceId: string; protocolVersion: number; clientNonce: string }): Buffer {
  return Buffer.from(JSON.stringify({ version: 1, challengeNonce: value.challengeNonce, connectionId: value.connectionId, deviceId: value.deviceId, protocolVersion: value.protocolVersion, clientNonce: value.clientNonce }), 'utf8');
}
export function publicKeyFingerprint(publicKeyPem: string): string { return createHash('sha256').update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })).digest('hex'); }
export function signPayload(privateKeyPem: string, payload: Buffer): string { return sign(null, payload, createPrivateKey(privateKeyPem)).toString('base64url'); }
