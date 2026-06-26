import { describe, it, expect, vi } from 'vitest';
import { ChannelImportService, type ImportDeps } from '../../../src/modules/channel/channel.import.service.js';
import type { ChannelRepository } from '../../../src/modules/channel/channel.repository.js';

// A Booking.com feed with the given VEVENT body.
const feed = (body: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', body, 'END:VCALENDAR'].join('\r\n');

const event = (uid: string, opts: { start: string; end: string; cancelled?: boolean }) =>
  [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${opts.start}`,
    `DTEND;VALUE=DATE:${opts.end}`,
    ...(opts.cancelled ? ['STATUS:CANCELLED'] : []),
    'END:VEVENT',
  ].join('\r\n');

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listImportRooms: vi.fn().mockResolvedValue([{ id: 'r1', code: 'J1', booking_ical_url: 'http://feed' }]),
    findBlockByUid: vi.fn().mockResolvedValue(undefined),
    insertImportedBlock: vi.fn().mockResolvedValue('res-new'),
    updateBlock: vi.fn().mockResolvedValue(undefined),
    cancelBlock: vi.fn().mockResolvedValue(undefined),
    listActiveBlockUids: vi.fn().mockResolvedValue([]),
    findConflicts: vi.fn().mockResolvedValue([]),
    recentCollisionAlertExists: vi.fn().mockResolvedValue(false),
    ...overrides,
  } as unknown as ChannelRepository;
}

function makeService(repo: ChannelRepository, deps: ImportDeps) {
  return new ChannelImportService(repo, deps);
}

describe('ChannelImportService.runImport', () => {
  it('inserts a fresh OTA block for a new event', async () => {
    const repo = makeRepo();
    const svc = makeService(repo, {
      fetchIcs: async () => feed(event('evt-1', { start: '20260701', end: '20260705' })),
      dispatchAlert: vi.fn(),
    });

    const summary = await svc.runImport();

    expect(summary.upserted).toBe(1);
    expect(summary.collisions).toBe(0);
    expect(repo.insertImportedBlock).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'r1', externalUid: 'evt-1' }),
    );
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

  it('prunes a block whose event has vanished from the feed', async () => {
    const repo = makeRepo({
      listActiveBlockUids: vi.fn().mockResolvedValue(['vanished']),
      findBlockByUid: vi.fn().mockResolvedValue({ id: 'res-v', status: 'BLOCKED', deleted_at: null }),
    });
    const svc = makeService(repo, {
      fetchIcs: async () => feed('X-WR-CALNAME:empty'), // no events
      dispatchAlert: vi.fn(),
    });

    const summary = await svc.runImport();

    expect(repo.cancelBlock).toHaveBeenCalledWith('res-v');
    expect(summary.cancelled).toBe(1);
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

    expect(summary.rooms[0].error).toContain('fetch failed');
    expect(summary.upserted).toBe(0);
  });
});
