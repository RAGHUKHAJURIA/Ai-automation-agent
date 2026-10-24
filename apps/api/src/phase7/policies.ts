import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { ServerConfig } from '@personal-agent/config/server';
import { policyRecordSchema } from '@personal-agent/contracts';
import { mongoClient, mongoDatabase } from '../infrastructure/mongodb.js';
import { originGuard, requireAuth } from '../phase1/http.js';

const names = [
  'email.search',
  'email.read',
  'email.draft',
  'email.update_draft',
  'email.send',
  'calendar.list_events',
  'calendar.get_event',
  'calendar.create_event',
  'calendar.update_event',
  'calendar.delete_event',
  'tasks.schedule',
] as const;
const consequential = new Set<string>([
  'email.send',
  'calendar.create_event',
  'calendar.update_event',
  'calendar.delete_event',
]);
const selection = z.object({ enabledTools: z.array(z.enum(names)).max(names.length) }).strict();

/** Explicit authenticated owner setup for only the Phase 7 tools. */
export function phase7PolicyRouter(config: ServerConfig): Router {
  const router = Router();
  router.use(requireAuth(config));
  router.get('/', async (request, response, next) => {
    try {
      const rows = await mongoDatabase()
        .collection('policies')
        .find({ ownerId: request.principal!.ownerId, phase7Managed: true })
        .project({ _id: 0, toolPatterns: 1, effect: 1 })
        .toArray();
      response.json({
        tools: names.map((name) => ({
          name,
          enabled:
            rows.find((row) => row.toolPatterns?.[0] === name)?.effect !== 'DENY' &&
            rows.some((row) => row.toolPatterns?.[0] === name),
        })),
      });
    } catch (error) {
      next(error);
    }
  });
  router.put('/', originGuard(config), async (request, response, next) => {
    const parsed = selection.safeParse(request.body);
    if (!parsed.success)
      return response.status(400).json({ error: { code: 'INVALID_PHASE7_PERMISSIONS' } });
    const ownerId = request.principal!.ownerId,
      enabled = new Set(parsed.data.enabledTools),
      now = new Date();
    try {
      const session = mongoClient().startSession();
      try {
        await session.withTransaction(async () => {
          for (const name of names) {
            const effect = enabled.has(name)
              ? consequential.has(name)
                ? 'REQUIRE_APPROVAL'
                : 'ALLOW'
              : 'DENY';
            const prior = await mongoDatabase()
              .collection('policies')
              .findOne({ ownerId, phase7Managed: true, toolPatterns: name }, { session });
            const policy = policyRecordSchema.parse({
              policyId: prior?.policyId ?? randomUUID(),
              ownerId,
              name: `Phase 7 ${name}`,
              description: 'Owner-managed connected-service permission',
              enabled: true,
              priority: 1000,
              effect,
              toolPatterns: [name],
              createdAt: prior?.createdAt ?? now,
              updatedAt: now,
            });
            await mongoDatabase()
              .collection('policies')
              .updateOne(
                { ownerId, policyId: policy.policyId },
                { $set: { ...policy, phase7Managed: true } },
                { upsert: true, session },
              );
          }
          await mongoDatabase()
            .collection('audit_events')
            .insertOne(
              {
                auditEventId: randomUUID(),
                ownerId,
                actorType: 'OWNER',
                actorId: ownerId,
                action: 'phase7.permissions.updated',
                targetType: 'policy',
                targetId: ownerId,
                outcome: 'SUCCESS',
                timestamp: now,
                metadata: { enabledTools: [...enabled] },
              },
              { session },
            );
        });
      } finally {
        await session.endSession();
      }
      return response.json({ enabledTools: [...enabled] });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
