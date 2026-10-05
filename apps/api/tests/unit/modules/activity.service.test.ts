import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ActivityService } from '../../../src/modules/activity/activity.service.js';

function serviceWith(rows: unknown[]) {
  const repo = { recent: vi.fn().mockResolvedValue(rows) } as never;
  return new ActivityService(repo);
}

const row = (over: Record<string, unknown>) => ({
  id: 'a1', action: 'CREATE', entity: 'reservations', diff: null,
  created_at: new Date('2026-09-01T08:00:00Z'), actor_name: 'Tumelo', ...over,
});

describe('ActivityService.recent', () => {
  // The costliest event this business can have. It used to fall through to the default
  // phrase — "created a record" — indistinguishable from anything else in the feed, and
  // the only other channel is an email needing two env vars set.
  it('names a Booking.com double-booking, and the unit it hit', async () => {
    const svc = serviceWith([
      row({
        entity: 'channel_collision',
        diff: JSON.stringify({ unit: 'B2', otaUid: 'x', conflicts: [{ id: 'r1' }] }),
      }),
    ]);
    const [item] = await svc.recent();
    expect(item!.action).toContain('double-booking');
    expect(item!.action).toContain('B2');
    expect(item!.action).not.toContain('a record');
  });

  it('still reads sensibly when the collision diff has no unit on it', async () => {
    const svc = serviceWith([row({ entity: 'channel_collision', diff: null })]);
    const [item] = await svc.recent();
    expect(item!.action).toContain('double-booking');
  });

  it('keeps the ordinary phrases intact', async () => {
    const svc = serviceWith([row({ entity: 'reservations', action: 'CREATE' })]);
    const [item] = await svc.recent();
    expect(item!.action).toBe('created a booking');
  });

  it('falls back rather than throwing on an entity it has never seen', async () => {
    const svc = serviceWith([row({ entity: 'something_new', action: 'UPDATE' })]);
    const [item] = await svc.recent();
    expect(item!.action).toBe('updated a record');
  });

  // (R6 item 20) The global feed was full of "updated a record" — payments, invoices, holds,
  // check-outs all fell through. Every entity the code audits (and the feed shows) now has
  // its own phrase; this scans the source so a new entity can't quietly fall through.
  it('has a real phrase for every entity the code writes to the audit log', async () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(join(__dirname, '../../../src'));
    const entities = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/entity: ?'([a-z_]+)'/g)) entities.add(m[1]!);
    }
    const hidden = ['auth_login', 'refresh_token', 'staff_compensation', 'user_password'];
    const shown = [...entities].filter((e) => !hidden.includes(e));
    expect(shown.length).toBeGreaterThan(15);

    const vague: string[] = [];
    for (const entity of shown) {
      for (const action of ['CREATE', 'UPDATE', 'DELETE']) {
        const [item] = await serviceWith([row({ entity, action })]).recent();
        if (item!.action.includes('a record')) vague.push(`${entity}/${action}`);
      }
    }
    expect(vague).toEqual([]);
  });

  it('says what happened to a payment, an invoice and a stay', async () => {
    const phrase = async (entity: string, action: string, diff: unknown) =>
      (await serviceWith([row({ entity, action, diff })]).recent())[0]!.action;
    expect(await phrase('payment_intents', 'UPDATE', { status: 'PAID' })).toBe('recorded a payment');
    expect(await phrase('payment_intents', 'UPDATE', { status: 'FAILED' })).toBe('marked a payment failed');
    expect(await phrase('invoices', 'UPDATE', { status: 'VOID' })).toBe('voided an invoice');
    expect(await phrase('invoices', 'UPDATE', { emailed_to: 'a@b.c' })).toBe('emailed an invoice');
    expect(await phrase('occupancy', 'UPDATE', { status: 'CHECKED_OUT' })).toBe('checked a guest out');
    expect(await phrase('occupancy', 'CREATE', null)).toBe('checked a guest in');
  });
});
