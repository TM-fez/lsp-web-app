/**
 * Notifications — the shared in-app alert channel (Phase 2 infrastructure).
 *
 * `notify()` is the one seam other modules call to raise an alert. It fans out to
 * concrete recipients at emit time (one row each), so downstream code never worries
 * about read-state or property scoping.
 */

/** Who should receive a notification. Resolved to concrete user ids before insert. */
export type NotifyTarget =
  | { userId: string }                       // one named recipient
  | { userIds: string[] }                    // several named recipients
  // Every member of a property (+ admins). excludeUserIds drops specific people
  // from the fan-out — typically the actor, who doesn't need an alert about
  // something they just did themselves.
  | { propertyId: string; excludeUserIds?: string[] };

/** The content of a single notification (recipient-independent). */
export interface NotifyPayload {
  type: string;                 // machine tag, e.g. 'reminder.checkout_due'
  title: string;
  body?: string | null;
  propertyId?: string | null;   // context; defaults to the target property when targeting one
  entityType?: string | null;   // deep-link target table, e.g. 'reservations'
  entityId?: string | null;     // deep-link target id
  link?: string | null;         // optional web path
  /**
   * Stable idempotency key WITHOUT the recipient — the service appends the user id.
   * Supply this from recurring producers (the reminder sweep) so re-runs don't
   * deliver the same alert twice. Omit for genuinely one-off notifications.
   */
  dedupKey?: string | null;
}

/** One notification as the bell renders it. */
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  property_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  link: string | null;
  read_at: Date | null;
  created_at: Date;
}
