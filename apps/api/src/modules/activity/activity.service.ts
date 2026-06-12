import { ActivityRepository } from './activity.repository.js';
import type { ActivityItem } from './activity.types.js';

type Action = 'CREATE' | 'UPDATE' | 'DELETE';

const VERBS: Record<string, Partial<Record<Action, string>>> = {
  rate_plans: { CREATE: 'added a rate plan', UPDATE: 'updated pricing', DELETE: 'removed a rate plan' },
  reservations: { CREATE: 'created a booking', UPDATE: 'updated a booking', DELETE: 'cancelled a booking' },
  contacts: { CREATE: 'added a guest', UPDATE: 'updated a guest', DELETE: 'removed a guest' },
  leads: { CREATE: 'logged an enquiry', UPDATE: 'updated an enquiry', DELETE: 'removed an enquiry' },
  rooms: { CREATE: 'added a unit', UPDATE: 'updated a unit', DELETE: 'removed a unit' },
  maintenance_work_orders: { CREATE: 'logged a repair', UPDATE: 'updated a repair', DELETE: 'removed a repair' },
  user: { CREATE: 'added a staff member', UPDATE: 'updated a staff member' },
  user_password: { UPDATE: 'reset a password' },
  housekeeping_tasks: { CREATE: 'opened a cleaning task', UPDATE: 'moved a cleaning task' },
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
  if (entity === 'rooms' && action === 'UPDATE' && d?.status) {
    const s = String(d.status).toLowerCase().replace('_', ' ');
    return `set a unit ${s}`;
  }

  return VERBS[entity]?.[action] ?? `${action.toLowerCase()}d a record`;
}

export class ActivityService {
  constructor(private readonly repo: ActivityRepository) {}

  async recent(limit = 30): Promise<ActivityItem[]> {
    const rows = await this.repo.recent(limit);
    return rows.map((r) => ({
      id: r.id,
      actor: r.actor_name ?? 'System',
      action: humanize(r.entity, r.action as Action, r.diff),
      entity: r.entity,
      created_at: r.created_at,
    }));
  }
}
