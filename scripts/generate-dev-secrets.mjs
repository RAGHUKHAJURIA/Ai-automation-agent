import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const source = new URL('../.env.example', import.meta.url);
const target = new URL('../.env', import.meta.url);
try {
  await readFile(target);
  process.stderr.write('.env already exists; refusing to overwrite it.\n');
  process.exitCode = 1;
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  const template = await readFile(source, 'utf8');
  const configured = template
    .replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET=${randomBytes(48).toString('base64url')}`)
    .replace(/^JWT_REFRESH_SECRET=.*$/m, `JWT_REFRESH_SECRET=${randomBytes(48).toString('base64url')}`);
  await writeFile(target, configured, { flag: 'wx', mode: 0o600 });
  process.stdout.write('Created ignored .env with independent random development JWT secrets.\n');
}
