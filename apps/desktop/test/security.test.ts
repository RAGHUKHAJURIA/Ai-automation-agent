import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateDeviceIdentity, canonicalPairingPayload, canonicalWorkerPayload, publicKeyFingerprint, signPayload } from '../src/main/pairing/crypto.js';
import { secureWindowPreferences } from '../src/main/window-security.js';

describe('desktop trust boundary', () => {
  it('uses hardened renderer preferences', () => {
    expect(secureWindowPreferences).toEqual({ nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false });
  });

  it('generates an Ed25519 device identity and signs canonical pairing/auth payloads', () => {
    const identity = generateDeviceIdentity();
    const pairing = { pairingRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', deviceId: identity.deviceId, ownerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', challengeNonce: 'c'.repeat(64), publicKeyFingerprint: publicKeyFingerprint(identity.publicKeyPem), protocolVersion: 1 };
    const signature = signPayload(identity.privateKeyPem, canonicalPairingPayload(pairing));
    expect(verify(null, canonicalPairingPayload(pairing), createPublicKey(identity.publicKeyPem), Buffer.from(signature, 'base64url'))).toBe(true);
    expect(verify(null, canonicalPairingPayload({ ...pairing, ownerId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }), createPublicKey(identity.publicKeyPem), Buffer.from(signature, 'base64url'))).toBe(false);
    const workerPayload = { challengeNonce: 'e'.repeat(64), connectionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', deviceId: identity.deviceId, protocolVersion: 1, clientNonce: 'f'.repeat(64) };
    const workerSignature = signPayload(identity.privateKeyPem, canonicalWorkerPayload(workerPayload));
    expect(verify(null, canonicalWorkerPayload(workerPayload), createPublicKey(identity.publicKeyPem), Buffer.from(workerSignature, 'base64url'))).toBe(true);
  });
});
