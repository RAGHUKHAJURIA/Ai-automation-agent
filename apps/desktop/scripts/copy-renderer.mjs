import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(packageRoot, 'dist', 'renderer');
await mkdir(destination, { recursive: true });
await cp(path.join(packageRoot, 'src', 'renderer'), destination, { recursive: true, force: true });
const helperSource = path.resolve(packageRoot, '..', '..', 'packages', 'desktop-adapters', 'windows', 'helper.py');
const helperDestination = path.join(packageRoot, 'dist', 'windows');
await mkdir(helperDestination, { recursive: true });
await cp(helperSource, path.join(helperDestination, 'helper.py'));
