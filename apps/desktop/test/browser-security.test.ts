import { describe, expect, it } from 'vitest';
import {
  classifyBrowserAction,
  isRestrictedHost,
  sanitizeDownloadFilename,
  validateBrowserUrl,
} from '../src/main/browser/security.js';

describe('browser security boundaries', () => {
  it('accepts only credential-free HTTP(S) public URLs', () => {
    expect(validateBrowserUrl('https://example.org/path').origin).toBe('https://example.org');
    expect(() => validateBrowserUrl('javascript:alert(1)')).toThrow('NAVIGATION_DENIED');
    expect(() => validateBrowserUrl('file:///C:/secret.txt')).toThrow('NAVIGATION_DENIED');
    expect(() => validateBrowserUrl('https://user:pass@example.org')).toThrow('NAVIGATION_DENIED');
    expect(() => validateBrowserUrl('http://127.0.0.1:3000')).toThrow('PRIVATE_NETWORK_DENIED');
  });

  it('blocks private address ranges and local names', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      '10.1.2.3',
      '172.20.1.1',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
    ])
      expect(isRestrictedHost(host)).toBe(true);
    expect(isRestrictedHost('8.8.8.8')).toBe(false);
    expect(isRestrictedHost('example.org')).toBe(false);
  });

  it('classifies ambiguous and submit-like controls conservatively', () => {
    expect(classifyBrowserAction('link', 'About')).toBe('NAVIGATION');
    expect(classifyBrowserAction('button', 'Next')).toBe('FORM_PROGRESS');
    expect(classifyBrowserAction('button', 'Send')).toBe('SEND_LIKE');
    expect(classifyBrowserAction('button', 'Continue')).toBe('FORM_PROGRESS');
    expect(classifyBrowserAction('button', 'Mystery')).toBe('UNKNOWN_CONSEQUENTIAL');
  });

  it('rejects download filenames that can escape or target reserved names', () => {
    expect(sanitizeDownloadFilename('report.pdf')).toBe('report.pdf');
    for (const name of [
      '../secret.txt',
      '..\\secret.txt',
      'C:\\secret.txt',
      '\\\\host\\share',
      'CON.txt',
      'bad\0name',
    ])
      expect(() => sanitizeDownloadFilename(name)).toThrow();
  });
});
