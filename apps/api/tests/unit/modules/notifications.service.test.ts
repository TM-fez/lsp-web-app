import { describe, it, expect, vi } from 'vitest';
import { NotificationsService } from '../../../src/modules/notifications/notifications.service.js';

function setup(overrides: Partial<Record<string, any>> = {}) {
  const repo = {
    insertMany: vi.fn(async (rows: any[]) => rows.length),
    userIdsForProperty: vi.fn(async () => ['a', 'b']),
    listForUser: vi.fn(async () => []),
    unreadCount: vi.fn(async () => 0),
    markRead: vi.fn(async () => 0),
    markAllRead: vi.fn(async () => 0),
    ...overrides,
  } as any;
  return { svc: new NotificationsService(repo), repo };
}

describe('NotificationsService.notify — fan-out', () => {
  it('single user → one row addressed to that user', async () => {
    const { svc, repo } = setup();
    const n = await svc.notify({ userId: 'u1' }, { type: 't', title: 'hi' });
    expect(n).toBe(1);
    expect(repo.insertMany).toHaveBeenCalledTimes(1);
    const rows = repo.insertMany.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: 'u1', type: 't', title: 'hi' });
  });

  it('userIds list is de-duplicated before insert', async () => {
    const { svc, repo } = setup();
    await svc.notify({ userIds: ['u1', 'u1', 'u2'] }, { type: 't', title: 'hi' });
    const rows = repo.insertMany.mock.calls[0][0];
    expect(rows.map((r: any) => r.user_id).sort()).toEqual(['u1', 'u2']);
  });

  it('property target fans out to every resolved member', async () => {
    const { svc, repo } = setup();
    await svc.notify({ propertyId: 'p1' }, { type: 't', title: 'hi' });
    expect(repo.userIdsForProperty).toHaveBeenCalledWith('p1');
    const rows = repo.insertMany.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    // Targeting a property implies that property is the context.
    expect(rows.every((r: any) => r.property_id === 'p1')).toBe(true);
  });

  it('no recipients → no insert, returns 0', async () => {
    const { svc, repo } = setup({ userIdsForProperty: vi.fn(async () => []) });
    const n = await svc.notify({ propertyId: 'empty' }, { type: 't', title: 'hi' });
    expect(n).toBe(0);
    expect(repo.insertMany).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.notify — idempotency key', () => {
  it('appends the recipient id so N recipients get N distinct keys', async () => {
    const { svc, repo } = setup();
    await svc.notify({ userIds: ['u1', 'u2'] }, { type: 't', title: 'hi', dedupKey: 'checkout:res1:2026-07-01' });
    const rows = repo.insertMany.mock.calls[0][0];
    expect(rows.map((r: any) => r.dedup_key)).toEqual([
      'checkout:res1:2026-07-01:u1',
      'checkout:res1:2026-07-01:u2',
    ]);
  });

  it('leaves dedup_key null for ad-hoc notifications', async () => {
    const { svc, repo } = setup();
    await svc.notify({ userId: 'u1' }, { type: 't', title: 'hi' });
    expect(repo.insertMany.mock.calls[0][0][0].dedup_key).toBeNull();
  });

  it('explicit propertyId in the payload overrides the target property', async () => {
    const { svc, repo } = setup();
    await svc.notify({ userId: 'u1' }, { type: 't', title: 'hi', propertyId: 'ctx' });
    expect(repo.insertMany.mock.calls[0][0][0].property_id).toBe('ctx');
  });
});

describe('NotificationsService read model', () => {
  it('delegates unread count / mark read to the repo, scoped to the user', async () => {
    const { svc, repo } = setup({
      unreadCount: vi.fn(async () => 5),
      markRead: vi.fn(async () => 2),
      markAllRead: vi.fn(async () => 9),
    });
    expect(await svc.unreadCount('u1')).toBe(5);
    expect(await svc.markRead('u1', ['x', 'y'])).toBe(2);
    expect(await svc.markAllRead('u1')).toBe(9);
    expect(repo.markRead).toHaveBeenCalledWith('u1', ['x', 'y']);
  });
});
