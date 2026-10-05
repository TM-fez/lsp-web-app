/**
 * (R6 item 19) Repair dates accepted year 0001 and 9999 and a twenty-year window. A
 * repair that "blocks" 2026–2046 quietly takes a unit off sale for good; one dated 0001
 * never blocks anything. Both are typing slips, so the schema refuses them.
 */
import { describe, it, expect } from 'vitest';
import { CreateWorkOrderSchema, UpdateWorkOrderSchema } from '../../../src/modules/maintenance/maintenance.types.js';

const base = { room_id: '00000000-0000-4000-8000-000000000001', title: 'Geyser', priority: 'HIGH' };
const ok = (from: string, to: string) => CreateWorkOrderSchema.safeParse({ ...base, blocks_from: from, blocks_to: to }).success;

describe('repair window bounds', () => {
  it('accepts an ordinary window', () => {
    expect(ok('2026-10-14', '2026-10-17')).toBe(true);
  });

  it('refuses years nobody means', () => {
    expect(ok('0001-01-01', '0001-01-05')).toBe(false);
    expect(ok('9999-01-01', '9999-01-05')).toBe(false);
  });

  it('refuses a date that is not on the calendar', () => {
    expect(ok('2026-02-30', '2026-03-02')).toBe(false);
  });

  it('refuses a window longer than a year — leave the dates empty to close it until done', () => {
    expect(ok('2026-10-01', '2046-10-01')).toBe(false);
    expect(ok('2026-10-01', '2027-10-02')).toBe(true); // 366 nights
    expect(ok('2026-10-01', '2027-10-03')).toBe(false);
  });

  it('applies the same bounds to an edit', () => {
    expect(UpdateWorkOrderSchema.safeParse({ blocks_from: '2026-10-01', blocks_to: '2046-10-01' }).success).toBe(false);
  });
});
