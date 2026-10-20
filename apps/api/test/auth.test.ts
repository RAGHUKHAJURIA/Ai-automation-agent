import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/phase1/auth.js';

describe('owner password hashing', () => {
  it('uses Argon2id and rejects incorrect passwords', async () => {
    const password = 'correct horse battery staple';
    const passwordHash = await hashPassword(password);
    expect(passwordHash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, 'incorrect password')).resolves.toBe(false);
  });

  it('rejects short and excessively long passwords', async () => {
    await expect(hashPassword('short')).rejects.toThrow('12 to 1024 bytes');
    await expect(hashPassword('x'.repeat(1_025))).rejects.toThrow('12 to 1024 bytes');
  });
});
