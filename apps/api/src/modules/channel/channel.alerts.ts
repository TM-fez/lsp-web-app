import { writeAuditLog } from '../../core/audit/audit.service.js';
import { sendEmail, isEmailConfigured } from '../../core/email/email.service.js';
import { sendWhatsAppMessage, type WhatsAppResult } from './channel.whatsapp.js';
import { env } from '../../config/env.js';
import { SYSTEM_USER_ID } from './channel.types.js';
import type { NewAuditLog } from '../../db/types.js';

// One direct stay that an incoming Booking.com night collides with.
export interface CollisionConflict {
  reservationId: string;
  status: string;
  source: string;
  guestName: string | null;
  checkIn: Date;
  checkOut: Date;
}

// A double-booking: an OTA night that overlaps an already direct-sold stay on a unit.
export interface CollisionAlert {
  unitCode: string;
  roomId: string;
  otaUid: string;
  otaCheckIn: Date;
  otaCheckOut: Date;
  conflicts: CollisionConflict[];
}

export interface AlertResult {
  channel: 'dashboard' | 'email' | 'whatsapp';
  status: 'sent' | 'skipped' | 'failed';
  detail?: string;
}

// Seams so the fan-out is unit-testable without a DB, an email provider, or env.
export interface DispatchDeps {
  writeAudit?: (entry: NewAuditLog) => Promise<void>;
  sendEmailFn?: (msg: { to: string; subject: string; html: string }) => Promise<{ messageId: string }>;
  emailConfigured?: () => boolean;
  alertEmail?: string;
  sendWhatsApp?: (text: string) => Promise<WhatsAppResult>;
}

function fmt(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function summaryText(a: CollisionAlert): string {
  const c = a.conflicts[0];
  const n = a.conflicts.length;
  return `⚠️ Double-booking on ${a.unitCode}: Booking.com ${fmt(a.otaCheckIn)}→${fmt(a.otaCheckOut)} clashes with a direct ${c?.status ?? ''} stay (${n} conflict${n === 1 ? '' : 's'}). The direct booking was kept; the OTA night was not stored.`;
}

// Dashboard channel: a distinctive audit_logs row. The activity feed reads audit_logs, so
// this surfaces as a visible "what's changed" line attributed to the Channel Sync actor.
async function sendDashboard(a: CollisionAlert, deps: DispatchDeps): Promise<AlertResult> {
  const writeAudit = deps.writeAudit ?? writeAuditLog;
  await writeAudit({
    request_id: null,
    user_id: SYSTEM_USER_ID,
    action: 'CREATE',
    entity: 'channel_collision',
    entity_id: a.roomId,
    diff: JSON.stringify({
      unit: a.unitCode,
      otaUid: a.otaUid,
      ota: { checkIn: fmt(a.otaCheckIn), checkOut: fmt(a.otaCheckOut) },
      conflicts: a.conflicts.map((c) => ({
        id: c.reservationId,
        status: c.status,
        source: c.source,
        guest: c.guestName,
        checkIn: fmt(c.checkIn),
        checkOut: fmt(c.checkOut),
      })),
    }),
    ip_address: null,
  });
  return { channel: 'dashboard', status: 'sent' };
}

async function sendEmailAlert(a: CollisionAlert, deps: DispatchDeps): Promise<AlertResult> {
  const configured = (deps.emailConfigured ?? isEmailConfigured)();
  const to = deps.alertEmail ?? env.CHANNEL_ALERT_EMAIL;
  if (!configured) return { channel: 'email', status: 'skipped', detail: 'email not configured' };
  if (!to) return { channel: 'email', status: 'skipped', detail: 'CHANNEL_ALERT_EMAIL not set' };

  const send = deps.sendEmailFn ?? sendEmail;
  const rows = a.conflicts
    .map(
      (c) =>
        `<li>${escapeHtml(c.status)} (${escapeHtml(c.source)}) ${fmt(c.checkIn)}→${fmt(c.checkOut)}` +
        `${c.guestName ? ` — ${escapeHtml(c.guestName)}` : ''} <code>${escapeHtml(c.reservationId)}</code></li>`,
    )
    .join('');
  await send({
    to,
    subject: `⚠️ Double-booking: ${a.unitCode} (${fmt(a.otaCheckIn)}→${fmt(a.otaCheckOut)})`,
    html:
      `<p>${escapeHtml(summaryText(a))}</p>` +
      `<p>Booking.com event <code>${escapeHtml(a.otaUid)}</code> overlaps existing direct stay(s) on <b>${escapeHtml(a.unitCode)}</b>:</p>` +
      `<ul>${rows}</ul>` +
      `<p>Move a guest or adjust availability — the OTA night was rejected, not stored.</p>`,
  });
  return { channel: 'email', status: 'sent' };
}

async function sendWhatsAppAlert(a: CollisionAlert, deps: DispatchDeps): Promise<AlertResult> {
  const fn = deps.sendWhatsApp ?? sendWhatsAppMessage;
  const r = await fn(summaryText(a));
  return { channel: 'whatsapp', status: r.status, detail: r.detail };
}

/**
 * Fan a collision out to every channel. Each is independent: one failing (a bad email
 * provider, a DB hiccup) must never block the others or the import poll. Returns a
 * per-channel result so the poll can log exactly what fired.
 */
export async function dispatchCollisionAlert(
  alert: CollisionAlert,
  deps: DispatchDeps = {},
): Promise<AlertResult[]> {
  const channels: AlertResult['channel'][] = ['dashboard', 'email', 'whatsapp'];
  const settled = await Promise.allSettled([
    sendDashboard(alert, deps),
    sendEmailAlert(alert, deps),
    sendWhatsAppAlert(alert, deps),
  ]);
  return settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { channel: channels[i]!, status: 'failed', detail: String((s as PromiseRejectedResult).reason) },
  );
}
