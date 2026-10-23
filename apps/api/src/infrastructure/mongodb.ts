import { MongoClient } from 'mongodb';

let client: MongoClient | undefined;
let connected = false;

export function mongoDatabase() {
  if (!client || !connected) throw new Error('MongoDB is not connected');
  return client.db();
}

export function mongoClient(): MongoClient {
  if (!client || !connected) throw new Error('MongoDB is not connected');
  return client;
}

export async function initializeIndexes(): Promise<void> {
  const database = mongoDatabase();
  const indexes: Array<[string, Array<Record<string, 1 | -1>>, { unique?: boolean; expireAfterSeconds?: number; name?: string }?]> = [
    ['owners', [{ normalizedEmail: 1 }], { unique: true, name: 'owners_email_unique' }],
    ['auth_sessions', [{ sessionId: 1 }], { unique: true }],
    ['auth_sessions', [{ ownerId: 1, expiresAt: 1 }]],
    ['auth_sessions', [{ expiresAt: 1 }], { expireAfterSeconds: 0, name: 'sessions_expiry' }],
    ['commands', [{ commandId: 1 }], { unique: true }],
    ['commands', [{ ownerId: 1, sourceChannel: 1, sourceEventId: 1 }], { unique: true, name: 'command_idempotency' }],
    ['commands', [{ ownerId: 1, receivedAt: -1 }]],
    ['tasks', [{ taskId: 1 }], { unique: true }],
    ['tasks', [{ commandId: 1 }]],
    ['tasks', [{ ownerId: 1, createdAt: -1 }]],
    ['tasks', [{ ownerId: 1, status: 1, updatedAt: -1 }]],
    ['task_events', [{ eventId: 1 }], { unique: true }],
    ['task_events', [{ taskId: 1, timestamp: 1 }]],
    ['tool_calls', [{ toolCallId: 1 }], { unique: true }],
    ['tool_calls', [{ taskId: 1, idempotencyKey: 1 }], { unique: true }],
    ['policies', [{ policyId: 1 }], { unique: true }],
    ['policies', [{ ownerId: 1, enabled: 1 }]],
    ['policy_decisions', [{ decisionId: 1 }], { unique: true }],
    ['policy_decisions', [{ taskId: 1, evaluatedAt: 1 }]],
    ['approvals', [{ approvalId: 1 }], { unique: true }],
    ['approvals', [{ ownerId: 1, status: 1, expiresAt: 1 }]],
    ['audit_events', [{ auditEventId: 1 }], { unique: true }],
    ['audit_events', [{ ownerId: 1, timestamp: -1 }]],
    ['audit_events', [{ taskId: 1, timestamp: -1 }]],
    ['audit_events', [{ action: 1, timestamp: -1 }]],
    ['outbox_events', [{ outboxEventId: 1 }], { unique: true }],
    ['outbox_events', [{ status: 1, availableAt: 1, leaseExpiresAt: 1 }]],
    ['agent_runs', [{ agentRunId: 1 }], { unique: true }],
    ['agent_runs', [{ ownerId: 1, createdAt: -1 }]],
    ['agent_runs', [{ taskId: 1 }], { unique: true, name: 'agent_run_task_unique' }],
    ['agent_iterations', [{ iterationId: 1 }], { unique: true }],
    ['agent_iterations', [{ agentRunId: 1, iterationNumber: 1 }], { unique: true }],
    ['model_usage', [{ usageId: 1 }], { unique: true }],
    ['model_usage', [{ ownerId: 1, createdAt: -1 }]],
    ['model_usage', [{ taskId: 1, createdAt: -1 }]],
    ['model_usage', [{ taskId: 1, iterationNumber: 1 }], { unique: true, name: 'usage_task_iteration_unique' }],
    ['devices', [{ deviceId: 1 }], { unique: true, name: 'device_id_unique' }],
    ['devices', [{ ownerId: 1, createdAt: -1 }]],
    ['devices', [{ publicKeyFingerprint: 1 }], { unique: true, name: 'device_key_fingerprint_unique' }],
    ['pairing_requests', [{ pairingRequestId: 1 }], { unique: true, name: 'pairing_request_id_unique' }],
    ['pairing_requests', [{ ownerId: 1, createdAt: -1 }]],
    ['pairing_requests', [{ expiresAt: 1 }]],
  ];
  for (const [collection, keys, options] of indexes) await database.collection(collection).createIndex(Object.assign({}, ...keys), options);
}

export async function connectMongo(uri: string): Promise<void> {
  const mongoClient = (client ??= new MongoClient(uri, { serverSelectionTimeoutMS: 3_000 }));
  try {
    await mongoClient.connect();
    await mongoClient.db().command({ ping: 1 });
    connected = true;
  } catch {
    connected = false;
    await mongoClient.close().catch(() => undefined);
    throw new Error('MongoDB connection failed');
  }
}

export async function checkMongo(): Promise<boolean> {
  const mongoClient = client;
  if (!mongoClient || !connected) return false;
  try {
    await mongoClient.db().command({ ping: 1 });
    return true;
  } catch {
    connected = false;
    return false;
  }
}

export async function disconnectMongo(): Promise<void> {
  connected = false;
  const mongoClient = client;
  if (mongoClient) await mongoClient.close();
  client = undefined;
}
