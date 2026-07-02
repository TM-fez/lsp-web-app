import { describe, it, expect, vi } from 'vitest';
import { ChannelImportService, feedNotes, type ImportDeps } from '../../../src/modules/channel/channel.import.service.js';
import type { ChannelRepository } from '../../../src/modules/channel/channel.repository.js';

// A Booking.com feed with the given VEVENT bodies.
const feed = (...bodies: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...bodies, 'END:VCALENDAR'].join('\r\n');

const event = (uid: string, opts: { start: string; end: string; cancelled?: boolean; summary?: string }) =>
  [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${opts.start}`,
    `DTEND;VALUE=DATE:${opts.end}`,
    ...(opts.summary ? [`SUMMARY:${opts.summary}`] : []),
    ...(opts.cancelled ? ['STATUS:CANCELLED'] : []),
    'END:VEVENT',
  ].join('\r\n');

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    tryAdvisoryLock: vi.fn().mockResolvedValue(true),
    releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
    listImportRooms: vi.fn().mockResolvedValue([{ id: 'r1', code: 'J1', booking_ical_url: 'http://feed' }]),
    findBlockByUid: vi.fn().mockResolvedValue(undefined),
    insertImportedBlock: vi.fn().mockResolvedValue('res-new'),
    updateBlock: vi.fn().mockResolvedValue(true),
    updateClaimedDates: vi.fn().mockResolvedValue(true),
    cancelBlock: vi.fn().mockResolvedValue(undefined),
    listActiveOtaRows: vi.fn().mockResolvedValue([]),
    findConflicts: vi.fn().mockResolvedValue([]),
    recentCollisionAlertExists: vi.fn().mockResolvedValue(false),
    ...overrides,
  } as unknown as ChannelRepository;
}

function makeService(repo: ChannelRepository, deps: ImportDeps) {
  return new ChannelImportService(repo, deps);
}

describe('ChannelImportService.runImport', () => {
  it('inserts a fresh OTA block for a new event (keeping the feed summary as notes)', async () => {
    const repo = makeRepo();
    const svc = makeService(repo, {
      fetchIcs: async () => feed(event('evt-1', { start: '20260701', end: '20260705', summary: 'CLOSED - Not available' })),
      dispatchAlert: vi.fn(),
    });

    const summary = await svc.runImport();

    expect(summary.ran).toBe(true);
    expect(summary.upserted).toBe(1);
    expect(summary.collisions).toBe(0);
    expect(repo.insertImportedBlock).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'r1', externalUid: 'evt-1', notes: 'OTA feed: CLOSED - Not available' }),
    );
  });

  it('refuses to run concurrently — a second trigger reports ran:false and touches nothing', async () => {
    const repo = makeRepo({ tryAdvisoryLock: vi.fn().mockResolvedValue(false) });
    const svc = makeService(repo, { fetchIcs: vi.fn(), dispatchAlert: vi.fn() });

    const summary = await svc.runImport();

    expect(summary.ran).toBe(false);
    expect(repo.listImportRooms).not.toHaveBeenCalled();
  });

  it('always releases the lock, even when a room import throws', async () => {
    const repo = makeRepo();
    const svc = makeService(repo, {
      fetchIcs: async () => {
        throw new Error('boom');
      },
      dispatchAlert: vi.fn(),
    });

    await svc.runImport();

    expect(repo.releaseAdvisoryLock).toHaveBeenCalledOnce();
  });

  it('updates (revives) an existing block instead of duplicating it', async () => {
    const repo = makeRepo({
      findBlockByUid: vi.fn().mockResolvedValue({ id: 'res-existing', status: 'CANCELLED', deleted_at: null }),
    });
    const svc = makeService(repo, {
      fetchIcs: async () => feed(event('evt-1', { start: '20260701', end: '20260705' })),
      dispatchAlert: vi.fn(),
    });

    await svc.runImport();

    expect(repo.updateBlock).toHaveBeenCalledWith('res-existing', expect.objectContaining({ roomId: 'r1' }));
    expect(repo.insertImportedBlock).not.toHaveBeenCalled();
  });

  it('counts an already-in-sync event as unchanged, not upserted', async () => {
    const repo = makeRepo({
      findBlockByUid: vi.fn().mockResolvedValue({ id: 'res-same', status: 'BLOCKED', deleted_at: null }),
      updateBlock: vi.fn().mockResolvedValue(false), // repo says: nothing differed
    });
    const svc = makeService(repo, {
      fetchIcs: async () => feed(event('evt-1', { start: '20260701', end: '20260705' })),
      dispatchAlert: vi.fn(),
    });

    const summary = await svc.runImport();

    expect(summary.upserted).toBe(0);
    expect(summary.unchanged).toBe(1);
  });

  it('a CLAIMED booking only follows the feed dates — status/contact stay staff-owned', async () => {
    const repo = makeRepo({
      findBlockByUid: vi.fn().mockResolvedValue({ id: 'res-claimed', status: 'CONFIRMED', deleted_at: null }),
    });
    const svc = makeService(repo, {
      fetchIcs: async () => feed(event('evt-1', { start: '20260710', end: '20260712' })),
      dispatchAlert: vi.fn(),
    });

    const summary = await svc.runImport();

    expect(repo.updateClaimedDates).toHaveBeenCalledWith('res-claimed', expect.any(Object));
    expect(repo.updateBlock).not.toHaveBeenCalled();
    expect(summary.upserted).toBe(1);
  });

  it('cancels a claimed CONFIRMED stay when the OTA event is CANCELLED (guest cancelled)', async () => {
    const repo = makeRepo({
      findBlockByUid: vi.fn().mockResolvedValue({ id: 'res-claimed', status: 'CONFIRMED', deleted_at: null }),
    });
    const svc = makeService(repo, {
      fetchIcs: async () => feed(event('evt-c', { start: '20260701', end: '20260705', cancelled: true })),
      dispatchAlert: vi.fn(),
    });

    const summary = await svc.runImport();

    expect(repo.cancelBlock).toHaveBeenCalledWith('res-claimed');
    expect(summary.cancelled).toBe(1);
  });

  it('NEVER cancels a checked-in guest, even when the OTA says cancelled — warns instead', async () => {
    const repo = makeRepo({
      findBlockByUid: vi.fn().mockResolvedValue({ id: 'res-inhouse', status: 'CHECKED_IN', deleted_at: null }),
    });
    const svc = makeService(repo, {
      fetchIcs: async () => feed(event('evt-c', { start: '20260701', end: '20260705', cancelled: true })),
      dispatchAlert: vi.fn(),
    });

    const summary = await svc.runImport();

    expect(repo.cancelBlock).not.toHaveBeenCalled();
    expect(summary.warnings).toBe(1);
  });

  it('on a 23P01 collision with a direct sale: alerts, keeps the direct booking, stores nothing', async () => {
    const conflict = {
      id: 'res-direct',
      status: 'CONFIRMED',
      source: 'DIRECT',
      guest_name: 'Alice',
      check_in_date: new Date('2026-07-02'),
      check_out_date: new Date('2026-07-06'),
    };
    const repo = makeRepo({
      insertImportedBlock: vi.fn().mockRejectedValue(Object.assign(new Error('exclusion'), { code: '23P01' })),
      findConflicts: vi.fn().mockResolvedValue([conflict]),
    });
    const dispatchAlert = vi.fn().mockResolvedValue([]);
    const svc = makeService(repo, {
      fetchIcs: async () => feed(event('evt-clash', { start: '20260701', end: '20260705' })),
      dispatchAlert,
    });

    const summary = await svc.runImport();

    expect(summary.collisions).toBe(1);
    expect(summary.alertsSuppressed).toBe(0);
    expect(summary.upserted).toBe(0);
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    const alert = dispatchAlert.mock.calls[0][0];
    expect(alert.unitCode).toBe('J1');
    expect(alert.otaUid).toBe('evt-clash');
    expect(alert.conflicts[0]).toMatchObject({ reservationId: 'res-direct', status: 'CONFIRMED', guestName: 'Alice' });
  });

  it('throttles a repeat page for the same UID, but still counts the collision', async () => {
    const repo = makeRepo({
      insertImportedBlock: vi.fn().mockRejectedValue(Object.assign(new Error('exclusion'), { code: '23P01' })),
      findConflicts: vi.fn().mockResolvedValue([
        { id: 'res-direct', status: 'CONFIRMED', source: 'DIRECT', guest_name: 'Alice', check_in_date: new Date('2026-07-02'), check_out_date: new Date('2026-07-06') },
      ]),
      recentCollisionAlertExists: vi.fn().mockResolvedValue(true), // already paged within 6h
    });
    const dispatchAlert = vi.fn().mockResolvedValue([]);
    const svc = makeService(repo, {
      fetchIcs: async () => feed(event('evt-clash', { start: '20260701', end: '20260705' })),
      dispatchAlert,
    });

    const summary = await svc.runImport();

    expect(summary.collisions).toBe(1); // still detected
    expect(summary.alertsSuppressed).toBe(1); // but not paged
    expect(dispatchAlert).not.toHaveBeenCalled();
    expect(repo.recentCollisionAlertExists).toHaveBeenCalledWith('evt-clash', 6);
  });

  it('does NOT alert on a 23P01 with no direct conflict (OTA-vs-OTA / anomaly)', async () => {
    const repo = makeRepo({
      insertImportedBlock: vi.fn().mockRejectedValue(Object.assign(new Error('exclusion'), { code: '23P01' })),
      findConflicts: vi.fn().mockResolvedValue([]),
    });
    const dispatchAlert = vi.fn();
    const svc = makeService(repo, {
      fetchIcs: async () => feed(event('evt-x', { start: '20260701', end: '20260705' })),
      dispatchAlert,
    });

    const summary = await svc.runImport();

    expect(dispatchAlert).not.toHaveBeenCalled();
    expect(summary.warnings).toBe(1);
    expect(summary.collisions).toBe(0);
  });

  it('ends a block when its event is CANCELLED in the feed', async () => {
    const repo = makeRepo({
      findBlockByUid: vi.fn().mockResolvedValue({ id: 'res-c', status: 'BLOCKED', deleted_at: null }),
    });
    const svc = makeService(repo, {
      fetchIcs: async () => feed(event('evt-c', { start: '20260701', end: '20260705', cancelled: true })),
      dispatchAlert: vi.fn(),
    });

    const summary = await svc.runImport();

    expect(repo.cancelBlock).toHaveBeenCalledWith('res-c');
    expect(summary.cancelled).toBe(1);
  });

  it('prunes a block whose event has vanished from a HEALTHY feed', async () => {
    const repo = makeRepo({
      listActiveOtaRows: vi.fn().mockResolvedValue([
        { external_uid: 'evt-live', status: 'BLOCKED' },
        { external_uid: 'vanished', status: 'BLOCKED' },
      ]),
      findBlockByUid: vi.fn().mockImplementation(async (uid: string) =>
        uid === 'vanished' ? { id: 'res-v', status: 'BLOCKED', deleted_at: null } : undefined,
      ),
    });
    const svc = makeService(repo, {
      fetchIcs: async () => feed(event('evt-live', { start: '20260701', end: '20260705' })),
      dispatchAlert: vi.fn(),
    });

    const summary = await svc.runImport();

    expect(repo.cancelBlock).toHaveBeenCalledWith('res-v');
    expect(summary.cancelled).toBe(1);
  });

  it('GUARD: an empty feed with active blocks skips the prune (broken feed, not empty calendar)', async () => {
    const repo = makeRepo({
      listActiveOtaRows: vi.fn().mockResolvedValue([{ external_uid: 'b1', status: 'BLOCKED' }]),
    });
    const svc = makeService(repo, {
      fetchIcs: async () => feed('X-WR-CALNAME:empty'), // 200 OK but zero events
      dispatchAlert: vi.fn(),
    });

    const summary = await svc.runImport();

    expect(repo.cancelBlock).not.toHaveBeenCalled();
    expect(summary.rooms[0]!.pruneSkipped).toBe(true);
    expect(summary.warnings).toBe(1);
  });

  it('GUARD: a poll that would end most of the calendar skips the prune', async () => {
    const repo = makeRepo({
      listActiveOtaRows: vi.fn().mockResolvedValue([
        { external_uid: 'evt-live', status: 'BLOCKED' },
        { external_uid: 'gone-1', status: 'BLOCKED' },
        { external_uid: 'gone-2', status: 'BLOCKED' },
        { external_uid: 'gone-3', status: 'BLOCKED' },
      ]),
      findBlockByUid: vi.fn().mockResolvedValue({ id: 'res-x', status: 'BLOCKED', deleted_at: null }),
    });
    const svc = makeService(repo, {
      fetchIcs: async () => feed(event('evt-live', { start: '20260701', end: '20260705' })),
      dispatchAlert: vi.fn(),
    });

    const summary = await svc.runImport();

    expect(repo.cancelBlock).not.toHaveBeenCalled();
    expect(summary.rooms[0]!.pruneSkipped).toBe(true);
  });

  it('a vanished CLAIMED booking is surfaced as a warning, never auto-cancelled', async () => {
    const repo = makeRepo({
      listActiveOtaRows: vi.fn().mockResolvedValue([
        { external_uid: 'evt-live', status: 'BLOCKED' },
        { external_uid: 'claimed-gone', status: 'CONFIRMED' },
      ]),
      findBlockByUid: vi.fn().mockResolvedValue(undefined),
    });
    const svc = makeService(repo, {
      fetchIcs: async () => feed(event('evt-live', { start: '20260701', end: '20260705' })),
      dispatchAlert: vi.fn(),
    });

    const summary = await svc.runImport();

    expect(repo.cancelBlock).not.toHaveBeenCalled();
    expect(summary.warnings).toBe(1);
  });

  it('records a per-unit error when the feed fetch fails, without throwing', async () => {
    const repo = makeRepo();
    const svc = makeService(repo, {
      fetchIcs: async () => {
        throw new Error('network down');
      },
      dispatchAlert: vi.fn(),
    });

    const summary = await svc.runImport();

    expect(summary.rooms[0]!.error).toContain('fetch failed');
    expect(summary.upserted).toBe(0);
  });
});

describe('feedNotes', () => {
  it('keeps summary and description, prefixed', () => {
    expect(feedNotes({ summary: 'Reserved', description: 'Phone: ***1234' })).toBe(
      'OTA feed: Reserved — Phone: ***1234',
    );
  });

  it('returns null when the feed says nothing', () => {
    expect(feedNotes({ summary: null, description: null })).toBeNull();
    expect(feedNotes({ summary: '  ', description: null })).toBeNull();
  });
});
