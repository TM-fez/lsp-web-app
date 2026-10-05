import { ActivityRepository, type ActivityViewer } from './activity.repository.js';
import type { ActivityItem } from './activity.types.js';

type Action = 'CREATE' | 'UPDATE' | 'DELETE';

const VERBS: Record<string, Partial<Record<Action, string>>> = {
  rate_plans: { CREATE: 'added a rate plan', UPDATE: 'updated pricing', DELETE: 'removed a rate plan' },
  reservations: { CREATE: 'created a booking', UPDATE: 'updated a booking', DELETE: 'cancelled a booking' },
  contacts: { CREATE: 'added a guest', UPDATE: 'updated a guest', DELETE: 'removed a guest' },
  leads: { CREATE: 'logged an enquiry', UPDATE: 'updated an enquiry', DELETE: 'removed an enquiry' },
  rooms: { CREATE: 'added a unit', UPDATE: 'updated a unit', DELETE: 'removed a unit' },
  maintenance_work_orders: { CREATE: 'logged a repair', UPDATE: 'updated a repair', DELETE: 'removed a repair' },
  user: { CREATE: 'added a staff member', UPDATE: 'updated a staff member', DELETE: 'removed a staff member' },
  users: { CREATE: 'added a staff member', UPDATE: 'updated a staff member', DELETE: 'removed a staff member' },
  user_password: { UPDATE: 'reset a password' },
  housekeeping_tasks: { CREATE: 'opened a cleaning task', UPDATE: 'moved a cleaning task', DELETE: 'removed a cleaning task' },
  // (R6 item 20) Everything below used to read "updated a record" in the global feed.
  housekeeping_checklist_items: { CREATE: 'added a checklist item', UPDATE: 'ticked a checklist item', DELETE: 'removed a checklist item' },
  occupancy: { CREATE: 'checked a guest in', UPDATE: 'updated a stay', DELETE: 'undid a check-in' },
  payment_intents: { CREATE: 'started a payment', UPDATE: 'updated a payment', DELETE: 'removed a payment' },
  invoices: { CREATE: 'issued an invoice', UPDATE: 'updated an invoice', DELETE: 'voided an invoice' },
  holds: { CREATE: 'held a unit', UPDATE: 'updated a hold', DELETE: 'released a hold' },
  quotes: { CREATE: 'sent a quote', UPDATE: 'updated a quote', DELETE: 'removed a quote' },
  files: { CREATE: 'uploaded a file', UPDATE: 'updated a file', DELETE: 'removed a file' },
  properties: { CREATE: 'added a property', UPDATE: 'updated a property', DELETE: 'removed a property' },
  buildings: { CREATE: 'added a block', UPDATE: 'updated a block', DELETE: 'removed a block' },
  operating_expense: { CREATE: 'recorded a cost', UPDATE: 'updated a cost', DELETE: 'removed a cost' },
  recurring_operating_cost: { CREATE: 'set up a recurring cost', UPDATE: 'updated a recurring cost', DELETE: 'stopped a recurring cost' },
  revenue_recognition: { CREATE: 'booked earned revenue', UPDATE: 'adjusted earned revenue', DELETE: 'reversed earned revenue' },
  app_settings: { CREATE: 'changed a setting', UPDATE: 'changed a setting', DELETE: 'reset a setting' },
};

// The status a payment, invoice, hold or stay moved to says more than "updated".
const STATUS_VERBS: Record<string, Record<string, string>> = {
  payment_intents: { PAID: 'recorded a payment', FAILED: 'marked a payment failed', EXPIRED: 'let a payment expire', RETRY: 'retried a payment' },
  invoices: { PAID: 'settled an invoice', VOID: 'voided an invoice', REFUNDED: 'refunded an invoice', PARTIALLY_PAID: 'took part payment on an invoice' },
  holds: { RELEASED: 'released a hold', EXPIRED: 'let a hold expire', CONVERTED: 'turned a hold into a booking' },
  occupancy: { CHECKED_OUT: 'checked a guest out' },
};

function asObject(diff: unknown): Record<string, unknown> | null {
  if (!diff) return null;
  if (typeof diff === 'object') return diff as Record<string, unknown>;
  if (typeof diff === 'string') {
    try { return JSON.parse(diff) as Record<string, unknown>; } catch { return null; }
  }
  return null;
}

/** Turn a raw audit row into a human phrase, refining a few entities via the diff. */
function humanize(entity: string, action: Action, diff: unknown): string {
  const d = asObject(diff);

  if (entity === 'maintenance_expense') {
    if (d?.spend_approved) return 'approved a repair spend';
    if (d?.reconciled) return 'reconciled an expense';
    return 'updated an expense';
  }
  if (entity === 'maintenance_work_orders' && action === 'UPDATE' && d) {
    if (d.approved_at) return 'signed off a repair';
    if (d.cost_amount !== undefined) return 'recorded a repair cost';
    if (d.status === 'COMPLETED') return 'completed a repair';
    if (d.status === 'IN_PROGRESS') return 'started a repair';
    if (d.assigned_to !== undefined) return 'assigned a repair';
  }
  if (entity === 'reservations' && action === 'UPDATE' && d) {
    if (d.discount_approved_at) return 'approved a discount';
    if (d.discount_value !== undefined && d.discount_value !== null) return 'applied a discount';
  }
  if (action === 'UPDATE' && d?.status && STATUS_VERBS[entity]?.[String(d.status)]) {
    return STATUS_VERBS[entity]![String(d.status)]!;
  }
  if (entity === 'invoices' && action === 'UPDATE' && d?.emailed_to) return 'emailed an invoice';
  if (entity === 'rooms' && action === 'UPDATE' && d?.status) {
    const s = String(d.status).toLowerCase().replace('_', ' ');
    return `set a unit ${s}`;
  }

  // The costliest thing that can happen to this business, and it used to fall through
  // to "created a record" — the default phrase, indistinguishable from any other row.
  // A Booking.com night arrived for a unit already sold and could not be stored, which
  // means the OTA believes it has an inventory we do not have. Name the unit, because
  // the feed is where anyone is going to notice it: the only other channel is an email
  // that needs BREVO_API_KEY and CHANNEL_ALERT_EMAIL both set.
  if (entity === 'channel_collision') {
    const unit = d?.unit ? ` on ${String(d.unit)}` : '';
    return `⚠️ found a Booking.com double-booking${unit} — the direct stay was kept`;
  }

  return VERBS[entity]?.[action] ?? `${action.toLowerCase()}d a record`;
}

export class ActivityService {
  constructor(private readonly repo: ActivityRepository) {}

  async recent(limit = 30, propertyId?: string, viewer?: ActivityViewer): Promise<ActivityItem[]> {
    const rows = await this.repo.recent(limit, propertyId, viewer);
    return rows.map((r) => ({
      id: r.id,
      actor: r.actor_name ?? 'System',
      action: humanize(r.entity, r.action as Action, r.diff),
      entity: r.entity,
      created_at: r.created_at,
    }));
  }
}
