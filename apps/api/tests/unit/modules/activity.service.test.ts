import { describe, it, expect, vi } from 'vitest';
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
});
