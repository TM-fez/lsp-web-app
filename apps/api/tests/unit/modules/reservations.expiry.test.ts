import { describe, it, expect, vi } from 'vitest';
import {
  expireStaleWebsiteBookings,
  type ExpiryDeps,
  type StaleWebsiteBooking,
} from '../../../src/modules/reservations/reservations.expiry.js';

const booking = (over: Partial<StaleWebsiteBooking> = {}): StaleWebsiteBooking => ({
  id: 'res-1',
  room_name: 'B1',
  guest_name: 'Thabo M',
  property_id: 'prop-1',
  check_in_date: new Date(2026, 6, 10),
  check_out_date: new Date(2026, 6, 12),
  ...over,
});

function makeDeps(stale: StaleWebsiteBooking[], over: Partial<ExpiryDeps> = {}): ExpiryDeps {
  return {
    findStale: vi.fn().mockResolvedValue(stale),
    cancel: vi.fn().mockResolvedValue(true),
    systemActorId: vi.fn().mockResolvedValue('actor-1'),
    notify: vi.fn().mockResolvedValue(1),
    ...over,
  };
}

describe('expireStaleWebsiteBookings', () => {
  it('cancels each stale booking and notifies its property', async () => {
    const deps = makeDeps([booking(), booking({ id: 'res-2', property_id: 'prop-2' })]);

    const expired = await expireStaleWebsiteBookings(deps, 24);

    expect(expired).toBe(2);
    expect(deps.cancel).toHaveBeenCalledWith('res-1', 'actor-1', 24);
    expect(deps.cancel).toHaveBeenCalledWith('res-2', 'actor-1', 24);
    expect(deps.notify).toHaveBeenCalledTimes(2);
    expect(deps.notify).toHaveBeenCalledWith(
      { propertyId: 'prop-2' },
      expect.objectContaining({
        type: 'reservation.website_expired',
        entityId: 'res-2',
        dedupKey: 'reservation.website_expired:res-2',
      }),
    );
  });

  it('computes the cutoff from the TTL', async () => {
    const deps = makeDeps([]);
    const now = new Date('2026-07-02T12:00:00Z');

    await expireStaleWebsiteBookings(deps, 24, now);

    expect(deps.findStale).toHaveBeenCalledWith(new Date('2026-07-01T12:00:00Z'));
  });

  it('a TTL of 0 disables the sweep without touching the DB', async () => {
    const deps = makeDeps([booking()]);

    expect(await expireStaleWebsiteBookings(deps, 0)).toBe(0);
    expect(deps.findStale).not.toHaveBeenCalled();
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it('skips (and does not notify) a booking confirmed between select and cancel', async () => {
    const deps = makeDeps([booking(), booking({ id: 'res-2' })], {
      cancel: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
    });

    const expired = await expireStaleWebsiteBookings(deps, 24);

    expect(expired).toBe(1);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(
      { propertyId: 'prop-1' },
      expect.objectContaining({ entityId: 'res-2' }),
    );
  });

  it('renders the calendar days in the staff-facing body', async () => {
    const deps = makeDeps([booking()]);

    await expireStaleWebsiteBookings(deps, 24);

    const payload = (deps.notify as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(payload.body).toContain('2026-07-10 → 2026-07-12');
    expect(payload.body).toContain('Thabo M');
  });
});
