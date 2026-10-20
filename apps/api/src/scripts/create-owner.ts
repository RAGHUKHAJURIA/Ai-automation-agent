import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { parseServerConfig } from '@personal-agent/config/server';
import { connectMongo, disconnectMongo, initializeIndexes } from '../infrastructure/mongodb.js';
import { createOwner } from '../phase1/auth.js';

async function hiddenPrompt(label: string): Promise<string> {
  if (!stdin.isTTY) throw new Error('Owner creation requires an interactive terminal');
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  let value = '';
  return await new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        const code = character.codePointAt(0) ?? 0;
        if (code === 3) return finish(new Error('Owner creation cancelled'));
        if (code === 13 || code === 10) return finish();
        if (code === 8 || code === 127) value = Array.from(value).slice(0, -1).join('');
        else if (code >= 32 && Buffer.byteLength(value, 'utf8') + Buffer.byteLength(character, 'utf8') <= 1_024) value += character;
      }
    };
    stdin.on('data', onData);
  });
}

async function run(): Promise<void> {
  const config = parseServerConfig(process.env);
  const reader = createInterface({ input: stdin, output: stdout });
  const email = (await reader.question('Owner email: ')).trim();
  reader.close();
  const password = await hiddenPrompt('Password (minimum 12 characters): ');
  const confirmation = await hiddenPrompt('Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords do not match');
  const displayReader = createInterface({ input: stdin, output: stdout });
  const displayName = await displayReader.question('Display name (optional): ');
  displayReader.close();
  await connectMongo(config.MONGODB_URI);
  try {
    await initializeIndexes();
    const ownerId = await createOwner(email, password, displayName);
    process.stdout.write(`Owner created: ${ownerId}\n`);
  } finally { await disconnectMongo(); }
}

run().catch(() => {
  process.stderr.write('Owner creation failed; verify prompt values and database availability.\n');
  process.exitCode = 1;
});
