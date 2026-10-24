import type { DeliveryStore, MessagingAdapter, TaskNotification } from '@personal-agent/messaging';
import { mongoDatabase } from '../infrastructure/mongodb.js';

export function createMongoDeliveryStore(): DeliveryStore {
  const deliveries = () => mongoDatabase().collection('messaging_deliveries');
  return {
    async reserve(
      notification: TaskNotification,
      provider: MessagingAdapter['provider'],
    ): Promise<boolean> {
      try {
        await deliveries().insertOne({
          notificationId: notification.notificationId,
          ownerId: notification.ownerId,
          taskId: notification.taskId,
          provider,
          recipientId: notification.recipientId,
          state: 'PREPARED',
          createdAt: notification.timestamp,
          updatedAt: notification.timestamp,
        });
        return true;
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11_000)
          return false;
        throw error;
      }
    },
    async markAccepted(
      notificationId: string,
      providerMessageId: string,
      acceptedAt: Date,
    ): Promise<void> {
      const result = await deliveries().updateOne(
        { notificationId, state: 'PREPARED' },
        { $set: { state: 'ACCEPTED', providerMessageId, acceptedAt, updatedAt: new Date() } },
      );
      if (!result.modifiedCount) throw new Error('DELIVERY_STATE_CONFLICT');
    },
    async markFailed(notificationId: string, errorCode: string): Promise<void> {
      await deliveries().updateOne(
        { notificationId, state: 'PREPARED' },
        { $set: { state: 'FAILED', errorCode, updatedAt: new Date() } },
      );
    },
    async markUnknown(notificationId: string): Promise<void> {
      await deliveries().updateOne(
        { notificationId, state: 'PREPARED' },
        { $set: { state: 'OUTCOME_UNKNOWN', updatedAt: new Date() } },
      );
    },
  };
}
