import { describe, expect, it } from 'vitest';
import { parseWebConfig } from '../src/web.js';

describe('parseWebConfig', () => {
  it('uses the local API URL when no browser config is provided', () => {
    expect(parseWebConfig({}).VITE_API_BASE_URL).toBe('http://localhost:3001');
  });

  it('rejects malformed public configuration', () => {
    expect(() => parseWebConfig({ VITE_API_BASE_URL: '/api' })).toThrow('VITE_API_BASE_URL');
  });
});
