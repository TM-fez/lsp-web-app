import type { NotificationsRepository, ListOptions } from './notifications.repository.js';
import type { NewNotification, NotificationRow } from '../../db/types.js';
import type { NotifyTarget, NotifyPayload, NotificationItem } from './notifications.types.js';

export class NotificationsService {
  constructor(private readonly repo: NotificationsRepository) {}

  /**
   * Raise an alert. This is the single seam other modules call. It resolves the
   * target to concrete recipients and writes one row each. Idempotent when the
   * payload carries a `dedupKey` (the reminder sweep relies on this). Never throws
   * on a "nobody to notify" — returns the number of rows actually inserted.
   */
  async notify(target: NotifyTarget, payload: NotifyPayload): Promise<number> {
    const userIds = await this.resolveRecipients(target);
    if (userIds.length === 0) return 0;

    // Targeting a property implies that property is the context, unless overridden.
    const propertyId =
      payload.propertyId ?? ('propertyId' in target ? target.propertyId : null);

    const rows: NewNotification[] = userIds.map((userId) => ({
      user_id: userId,
      property_id: propertyId ?? null,
      type: payload.type,
      title: payload.title,
      body: payload.body ?? null,
      entity_type: payload.entityType ?? null,
      entity_id: payload.entityId ?? null,
      link: payload.link ?? null,
      // Append the recipient so the same alert to N people yields N distinct keys.
      dedup_key: payload.dedupKey ? `${payload.dedupKey}:${userId}` : null,
    }));

    return this.repo.insertMany(rows);
  }

  private async resolveRecipients(target: NotifyTarget): Promise<string[]> {
    if ('userId' in target) return [target.userId];
    if ('userIds' in target) return [...new Set(target.userIds)];
    const members = await this.repo.userIdsForProperty(target.propertyId);
    const excluded = new Set(target.excludeUserIds ?? []);
    return members.filter((id) => !excluded.has(id));
  }

  async list(userId: string, opts: ListOptions = {}): Promise<NotificationItem[]> {
    const rows = await this.repo.listForUser(userId, opts);
    return rows.map(toItem);
  }

  unreadCount(userId: string): Promise<number> {
    return this.repo.unreadCount(userId);
  }

  markRead(userId: string, ids: string[]): Promise<number> {
    return this.repo.markRead(userId, ids);
  }

  markAllRead(userId: string): Promise<number> {
    return this.repo.markAllRead(userId);
  }
}

function toItem(r: NotificationRow): NotificationItem {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    property_id: r.property_id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    link: r.link,
    read_at: r.read_at,
    created_at: r.created_at,
  };
}
