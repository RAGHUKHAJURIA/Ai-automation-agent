import { isIP } from 'node:net';
export { isDomainAllowed, normalizeDomainRule } from '@personal-agent/policy';

export type BrowserActionRisk =
  | 'NAVIGATION'
  | 'NON_CONSEQUENTIAL'
  | 'FORM_PROGRESS'
  | 'SUBMIT_LIKE'
  | 'DELETE_LIKE'
  | 'PURCHASE_LIKE'
  | 'SEND_LIKE'
  | 'UNKNOWN_CONSEQUENTIAL';

export function classifyBrowserAction(kind: string, name: string, type = ''): BrowserActionRisk {
  const label = `${kind} ${name} ${type}`.toLocaleLowerCase();
  if (/delete|remove|unsubscribe|revoke/.test(label)) return 'DELETE_LIKE';
  if (/purchase|buy|pay|order|checkout/.test(label)) return 'PURCHASE_LIKE';
  if (/send|publish|post|share/.test(label)) return 'SEND_LIKE';
  if (
    /submit|apply|confirm|authorize|agree|accept|place order/.test(label) ||
    type.toLowerCase() === 'submit'
  )
    return 'SUBMIT_LIKE';
  if (/next|continue|save draft/.test(label)) return 'FORM_PROGRESS';
  if (kind === 'link') return 'NAVIGATION';
  if (kind === 'button') return 'UNKNOWN_CONSEQUENTIAL';
  return 'NON_CONSEQUENTIAL';
}

export function validateBrowserUrl(raw: string, allowPrivateFixture = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('INVALID_URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('NAVIGATION_DENIED');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!allowPrivateFixture && isRestrictedHost(hostname)) throw new Error('PRIVATE_NETWORK_DENIED');
  return url;
}

export function isRestrictedHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.startsWith('::ffff:')) return isRestrictedHost(host.slice(7));
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map(Number);
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0]! >= 224 ||
      (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
      (parts[0] === 192 && (parts[1] === 168 || parts[1] === 0)) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
    );
  }
  if (ipVersion === 6)
    return (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      /^fe[89ab]/.test(host) ||
      host.startsWith('::ffff:127.')
    );
  return false;
}

export function sanitizeDownloadFilename(filename: string): string {
  if (
    !filename ||
    filename.includes('\0') ||
    /[/\\]/.test(filename) ||
    filename === '.' ||
    filename === '..' ||
    /^[a-z]:/i.test(filename) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(filename)
  )
    throw new Error('INVALID_DOWNLOAD_FILENAME');
  return filename;
}
