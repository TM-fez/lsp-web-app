import { describe, it, expect, vi } from 'vitest';
import { OperatingExpensesService } from '../../../src/modules/operating-expenses/operating-expenses.service.js';

// (Audit 2026-10-11, M-7) "payroll:…" / "recurring:…" notes are the system's own markers for
// "this month is done". Typed by hand they could close another property's month.
describe('OperatingExpensesService — reserved notes', () => {
  const repo = {
    create: vi.fn().mockResolvedValue({ id: 'e1' }),
    update: vi.fn().mockResolvedValue({ id: 'e1' }),
    findById: vi.fn().mockResolvedValue({ id: 'e1', notes: 'payroll:2031-09' }),
  };
  const svc = new OperatingExpensesService(repo as never);
  const base = { category: 'OTHER', description: 'x', amount: 100, incurred_on: new Date('2031-09-01') } as never;
  const meta = { userId: 'u' };

  it('refuses a new cost whose notes start with a system marker', () => {
    for (const notes of ['payroll:2031-09', '  Recurring:abc:2031-09']) {
      expect(() => svc.create({ ...(base as object), notes } as never, meta)).toThrow(/kept for the system/);
    }
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('allows ordinary notes', async () => {
    await svc.create({ ...(base as object), notes: 'Paid via payroll account' } as never, meta);
    expect(repo.create).toHaveBeenCalled();
  });

  it('lets a system-posted cost be re-saved with its marker unchanged, but not changed to another', async () => {
    await expect(svc.update('e1', { notes: 'payroll:2031-09' } as never, meta)).resolves.toBeDefined();
    await expect(svc.update('e1', { notes: 'payroll:2031-10' } as never, meta)).rejects.toThrow(/kept for the system/);
  });
});
