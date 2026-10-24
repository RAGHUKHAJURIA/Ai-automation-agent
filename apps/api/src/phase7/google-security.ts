import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const googleScopes = {
  gmailRead: 'https://www.googleapis.com/auth/gmail.readonly',
  gmailCompose: 'https://www.googleapis.com/auth/gmail.compose',
  calendarRead: 'https://www.googleapis.com/auth/calendar.events.readonly',
  calendarWrite: 'https://www.googleapis.com/auth/calendar.events',
} as const;

export const googleCapabilities = [
  'gmail.read',
  'gmail.compose',
  'calendar.read',
  'calendar.write',
] as const;
export type GoogleCapability = (typeof googleCapabilities)[number];

export function scopesFor(capabilities: GoogleCapability[]): string[] {
  const scopes = new Set<string>(['openid', 'email']);
  for (const capability of capabilities) {
    switch (capability) {
      case 'gmail.read':
        scopes.add(googleScopes.gmailRead);
        break;
      case 'gmail.compose':
        scopes.add(googleScopes.gmailCompose);
        break;
      case 'calendar.read':
        scopes.add(googleScopes.calendarRead);
        break;
      case 'calendar.write':
        scopes.add(googleScopes.calendarWrite);
        break;
    }
  }
  return [...scopes];
}

export function capabilitiesFor(grantedScopes: string[]): GoogleCapability[] {
  const granted = new Set(grantedScopes);
  return googleCapabilities.filter((capability) => {
    if (capability === 'gmail.read') return granted.has(googleScopes.gmailRead);
    if (capability === 'gmail.compose') return granted.has(googleScopes.gmailCompose);
    if (capability === 'calendar.read')
      return granted.has(googleScopes.calendarRead) || granted.has(googleScopes.calendarWrite);
    return granted.has(googleScopes.calendarWrite);
  });
}

export const requestedCapabilitiesSchema = z
  .object({ capabilities: z.array(z.enum(googleCapabilities)).min(1).max(4) })
  .strict();

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface EncryptedSecret {
  version: 1;
  keyId: 'google-v1';
  iv: string;
  ciphertext: string;
  tag: string;
}

export function encryptSecret(
  plaintext: string,
  base64Key: string,
  associatedData: string,
): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(base64Key, 'base64'), iv);
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    version: 1,
    keyId: 'google-v1',
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptSecret(
  secret: EncryptedSecret,
  base64Key: string,
  associatedData: string,
): string {
  if (secret.version !== 1 || secret.keyId !== 'google-v1')
    throw new Error('GOOGLE_CREDENTIAL_VERSION_UNSUPPORTED');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(base64Key, 'base64'),
    Buffer.from(secret.iv, 'base64'),
  );
  decipher.setAAD(Buffer.from(associatedData));
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
