import { describe, it, expect, vi } from 'vitest';
import { dispatchCollisionAlert, type CollisionAlert } from '../../../src/modules/channel/channel.alerts.js';

const alert: CollisionAlert = {
  unitCode: 'J1',
  roomId: 'r1',
  otaUid: 'evt-clash@booking.com',
  otaCheckIn: new Date('2026-07-01'),
  otaCheckOut: new Date('2026-07-05'),
  conflicts: [
    {
      reservationId: 'res-direct',
      status: 'CONFIRMED',
      source: 'DIRECT',
      guestName: 'Alice',
      checkIn: new Date('2026-07-02'),
      checkOut: new Date('2026-07-06'),
    },
  ],
};

describe('dispatchCollisionAlert', () => {
  it('always writes the dashboard entry; skips email + WhatsApp when not configured', async () => {
    const writeAudit = vi.fn().mockResolvedValue(undefined);
    const results = await dispatchCollisionAlert(alert, {
      writeAudit,
      emailConfigured: () => false,
      sendWhatsApp: async () => ({ status: 'skipped', detail: 'dark' }),
    });

    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit.mock.calls[0][0]).toMatchObject({ entity: 'channel_collision', entity_id: 'r1' });
    expect(results).toEqual([
      { channel: 'dashboard', status: 'sent' },
      { channel: 'email', status: 'skipped', detail: 'email not configured' },
      { channel: 'whatsapp', status: 'skipped', detail: 'dark' },
    ]);
  });

  it('sends email when configured and an alert address is set', async () => {
    const sendEmailFn = vi.fn().mockResolvedValue({ messageId: 'm1' });
    const results = await dispatchCollisionAlert(alert, {
      writeAudit: vi.fn().mockResolvedValue(undefined),
      emailConfigured: () => true,
      alertEmail: 'manager@lifestyle.test',
      sendEmailFn,
      sendWhatsApp: async () => ({ status: 'skipped' }),
    });

    expect(sendEmailFn).toHaveBeenCalledTimes(1);
    const msg = sendEmailFn.mock.calls[0][0];
    expect(msg.to).toBe('manager@lifestyle.test');
    expect(msg.subject).toContain('J1');
    expect(msg.html).toContain('Alice');
    expect(results.find((r) => r.channel === 'email')).toMatchObject({ status: 'sent' });
  });

  it('isolates a failing channel — one failure does not sink the others', async () => {
    const results = await dispatchCollisionAlert(alert, {
      writeAudit: vi.fn().mockRejectedValue(new Error('db down')),
      emailConfigured: () => false,
      sendWhatsApp: async () => ({ status: 'skipped' }),
    });

    expect(results[0]).toMatchObject({ channel: 'dashboard', status: 'failed' });
    expect(results[1]).toMatchObject({ channel: 'email', status: 'skipped' });
    expect(results[2]).toMatchObject({ channel: 'whatsapp', status: 'skipped' });
  });
});
