import { parseServerConfig } from '@personal-agent/config/server';
import { connectMongo, disconnectMongo, initializeIndexes, mongoDatabase } from '../infrastructure/mongodb.js';

async function migrate(): Promise<void> {
  const config = parseServerConfig(process.env);
  await connectMongo(config.MONGODB_URI);
  try {
    const topology = await mongoDatabase().admin().command({ hello: 1 });
    if (topology.setName !== 'rs0') throw new Error('MongoDB must use replica set rs0 for transaction support');
    await initializeIndexes();
    process.stdout.write('Database indexes initialized.\n');
  } finally { await disconnectMongo(); }
}

migrate().catch(() => {
  process.stderr.write('Database initialization failed; verify MongoDB availability and replica-set configuration.\n');
  process.exitCode = 1;
});
