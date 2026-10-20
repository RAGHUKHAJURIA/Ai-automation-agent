import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { parseServerConfig } from '@personal-agent/config/server';
import { readToken } from '../src/phase1/auth.js';

const accessSecret = 'unit-access-secret-'.padEnd(64, 'a');
const refreshSecret = 'unit-refresh-secret-'.padEnd(64, 'b');
const config = parseServerConfig({
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: accessSecret,
  JWT_REFRESH_SECRET: refreshSecret,
});

async function token(claims: Record<string, unknown>, issuer = config.JWT_ISSUER, audience = config.JWT_AUDIENCE, expires = '5m', key = accessSecret) {
  return new SignJWT(claims).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer(issuer).setAudience(audience)
    .setSubject(randomUUID()).setJti(randomUUID()).setIssuedAt().setExpirationTime(expires)
    .sign(new TextEncoder().encode(key));
}

describe('JWT claim validation', () => {
  it('accepts a correctly signed access token with expected claims', async () => {
    const access = await token({ type: 'access', sid: randomUUID(), ver: 0 });
    await expect(readToken(access, 'access', config)).resolves.toMatchObject({ type: 'access' });
  });

  it('rejects the wrong token type, expiry, issuer, audience, and signature', async () => {
    const refresh = await token({ type: 'refresh', sid: randomUUID(), ver: 0 });
    const expired = await token({ type: 'access', sid: randomUUID(), ver: 0 }, config.JWT_ISSUER, config.JWT_AUDIENCE, '-1s');
    const wrongIssuer = await token({ type: 'access', sid: randomUUID(), ver: 0 }, 'unexpected-issuer');
    const wrongAudience = await token({ type: 'access', sid: randomUUID(), ver: 0 }, config.JWT_ISSUER, 'unexpected-audience');
    const wrongSignature = await token({ type: 'access', sid: randomUUID(), ver: 0 }, config.JWT_ISSUER, config.JWT_AUDIENCE, '5m', refreshSecret);
    await expect(readToken(refresh, 'access', config)).rejects.toThrow();
    await expect(readToken(expired, 'access', config)).rejects.toThrow();
    await expect(readToken(wrongIssuer, 'access', config)).rejects.toThrow();
    await expect(readToken(wrongAudience, 'access', config)).rejects.toThrow();
    await expect(readToken(wrongSignature, 'access', config)).rejects.toThrow();
  });
});
