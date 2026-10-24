import { createHash } from 'node:crypto';
import type { ServerConfig } from '@personal-agent/config/server';
import type {
  InboundCommandHandlers,
  InboundMessage,
  MessagingAdapter,
} from '@personal-agent/messaging';
import { processInboundMessage } from '@personal-agent/messaging';
import { mongoDatabase } from '../infrastructure/mongodb.js';
import { createCanonicalCommand } from '../phase1/command-ingestion.js';

/** The fixture path is available to tests only. No production webhook mounts it. */
export function createFixtureMessagingIngress(config: ServerConfig, adapter: MessagingAdapter) {
  if (process.env.NODE_ENV !== 'test' || adapter.provider !== 'TEST_FIXTURE')
    throw new Error('MESSAGING_PROVIDER_NOT_ENABLED');
  const handlers: InboundCommandHandlers = {
    async resolveOwner(provider, senderId) {
      const identity = await mongoDatabase()
        .collection('messaging_identities')
        .findOne({ provider, senderId, enabled: true, revokedAt: null });
      return identity && typeof identity.ownerId === 'string' ? identity.ownerId : null;
    },
    async createCommand(ownerId: string, event: InboundMessage) {
      const result = await createCanonicalCommand(config, {
        ownerId,
        sourceChannel: 'api',
        sourceEventId: `fixture:${createHash('sha256').update(event.providerEventId).digest('hex')}`,
        text: event.text,
        timezone: 'UTC',
        conversationId: event.conversationId,
        actorId: event.senderId,
      });
      return { taskId: result.taskId, duplicate: result.duplicate };
    },
    async handleControl(_ownerId, _event, command) {
      if (command.kind === 'HELP')
        return 'Send a command. This fixture does not provide remote task controls.';
      return 'REMOTE_CONTROL_NOT_CONFIGURED';
    },
  };
  return (rawBody: Uint8Array, signature: string) =>
    processInboundMessage(adapter, rawBody, signature, handlers);
}
