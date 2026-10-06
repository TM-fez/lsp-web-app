import { describe, it, expect } from 'vitest';
import { addDays, barPlacement, bookingLabel, bookingTone, dayColumns, daysBetween, moveTarget } from './util';

describe('calendar util', () => {
  it('steps days across month and year ends without touching the browser’s zone', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-05', '2026-11-01')).toBe(27);
  });

  it('labels columns like LH — weekday, day, month — and shades the weekend', () => {
    const cols = dayColumns('2026-10-09', 3);
    expect(cols.map((c) => `${c.weekday} ${c.day} ${c.month}`)).toEqual(['FRI 09 OCT', 'SAT 10 OCT', 'SUN 11 OCT']);
    expect(cols.map((c) => c.weekend)).toEqual([false, true, true]);
  });

  it('runs a bar from mid arrival-day to mid departure-morning, so a turnover meets in one square', () => {
    // 7 nights shown from the 1st. Stay 2nd → 4th: from 1.5 to 3.5 of 7.
    expect(barPlacement('2026-10-02', '2026-10-04', '2026-10-01', 7)).toEqual({
      left: 1.5 / 7, width: 2 / 7, openStart: false, openEnd: false,
    });
    const out = barPlacement('2026-10-02', '2026-10-04', '2026-10-01', 7)!;
    const next = barPlacement('2026-10-04', '2026-10-06', '2026-10-01', 7)!;
    expect(out.left + out.width).toBeCloseTo(next.left);
  });

  it('cuts a stay flat at the edge when it started before, or runs past, the window', () => {
    expect(barPlacement('2026-09-20', '2026-10-03', '2026-10-01', 7)).toEqual({
      left: 0, width: 2.5 / 7, openStart: true, openEnd: false,
    });
    expect(barPlacement('2026-10-06', '2026-10-20', '2026-10-01', 7)).toEqual({
      left: 5.5 / 7, width: 1.5 / 7, openStart: false, openEnd: true,
    });
    // A closure with no dates fills the row.
    expect(barPlacement(null, null, '2026-10-01', 7)).toEqual({ left: 0, width: 1, openStart: true, openEnd: true });
  });

  it('draws nothing for a stay with no night on screen', () => {
    expect(barPlacement('2026-09-20', '2026-10-01', '2026-10-01', 7)).toBeNull();
    expect(barPlacement('2026-10-08', '2026-10-09', '2026-10-01', 7)).toBeNull();
  });

  it('names a bar "Company, Guest" and colours it by status', () => {
    expect(bookingLabel({ guest_name: 'Alexander Forbes', company_name: 'Financial Services Botswana', status: 'CONFIRMED', source: 'DIRECT' }))
      .toBe('Financial Services Botswana, Alexander Forbes');
    expect(bookingLabel({ guest_name: 'Yuka Nagaoka', company_name: null, status: 'CHECKED_IN', source: 'DIRECT' })).toBe('Yuka Nagaoka');
    expect(bookingLabel({ guest_name: null, company_name: null, status: 'BLOCKED', source: 'BOOKING_COM' })).toBe('Booking.com');
    expect(bookingTone('CHECKED_IN')).toBe('in');
    expect(bookingTone('CHECKED_OUT')).toBe('out');
    expect(bookingTone('PENDING')).toBe('pending');
    expect(bookingTone('BLOCKED')).toBe('confirmed');
  });

  describe('where a drag lands (calendar drag)', () => {
    const stay = { room_id: 'b2', check_in_date: '2026-10-25', check_out_date: '2026-10-27', status: 'CONFIRMED' as const };

    it('moves the whole stay, and to another unit', () => {
      expect(moveTarget(stay, 'move', 1, 'b2')).toEqual({ room_id: 'b2', check_in_date: '2026-10-26', check_out_date: '2026-10-28' });
      expect(moveTarget(stay, 'move', -2, 'd6')).toEqual({ room_id: 'd6', check_in_date: '2026-10-23', check_out_date: '2026-10-25' });
    });

    it('stretches or shortens by the leaving day, never below one night', () => {
      expect(moveTarget(stay, 'resize', 3, 'ignored')).toEqual({ room_id: 'b2', check_in_date: '2026-10-25', check_out_date: '2026-10-30' });
      expect(moveTarget(stay, 'resize', -5, 'b2')).toEqual({ room_id: 'b2', check_in_date: '2026-10-25', check_out_date: '2026-10-26' });
    });

    it('never moves an in-house guest’s arrival day — only the unit', () => {
      const inHouse = { ...stay, status: 'CHECKED_IN' as const };
      expect(moveTarget(inHouse, 'move', 2, 'b2')).toBeNull();
      expect(moveTarget(inHouse, 'move', 2, 'd6')).toEqual({ room_id: 'd6', check_in_date: '2026-10-25', check_out_date: '2026-10-27' });
      expect(moveTarget(inHouse, 'resize', 1, 'b2')).toEqual({ room_id: 'b2', check_in_date: '2026-10-25', check_out_date: '2026-10-28' });
    });

    it('is nothing when the bar ends where it started', () => {
      expect(moveTarget(stay, 'move', 0, 'b2')).toBeNull();
    });
  });
});
