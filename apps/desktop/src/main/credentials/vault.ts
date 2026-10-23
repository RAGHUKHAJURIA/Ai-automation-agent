import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import { z } from 'zod';

const pendingPairingSchema = z.object({ backendUrl: z.string().url(), pairingRequestId: z.string().uuid(), challengeNonce: z.string().regex(/^[a-f0-9]{64}$/), publicKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.string().datetime(), displayName: z.string().min(1).max(64) }).strict();
const identitySchema = z.object({ deviceId: z.string().uuid(), ownerId: z.string().uuid(), backendUrl: z.string().url(), privateKeyPem: z.string().min(1), publicKeyPem: z.string().min(1), credentialVersion: z.number().int().positive(), pendingPairing: pendingPairingSchema.optional() }).strict();
export type DeviceIdentity = z.infer<typeof identitySchema>;

export class CredentialVault {
  private readonly filePath: string;
  constructor(userDataPath: string) { this.filePath = path.join(userDataPath, 'device-credential.bin'); }

  async isAvailable(): Promise<boolean> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
    return true;
  }

  async store(identity: DeviceIdentity): Promise<void> {
    if (!(await this.isAvailable())) throw new Error('SECURE_STORAGE_UNAVAILABLE');
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(identity));
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' });
    await rename(temporary, this.filePath);
  }

  async load(): Promise<DeviceIdentity | null> {
    if (!(await this.isAvailable())) throw new Error('SECURE_STORAGE_UNAVAILABLE');
    try {
      const encrypted = await readFile(this.filePath);
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      if (decrypted.shouldReEncrypt) await this.store(identitySchema.parse(JSON.parse(decrypted.result)));
      return identitySchema.parse(JSON.parse(decrypted.result));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('DEVICE_CREDENTIAL_UNREADABLE');
    }
  }

  async clear(): Promise<void> { await unlink(this.filePath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
}
