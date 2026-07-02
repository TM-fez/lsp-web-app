import { describe, it, expect, vi } from 'vitest';
import { HousekeepingService } from '../../../src/modules/housekeeping/housekeeping.service.js';

function setup(liveTask: any, uncheckedItems: any[] = []) {
  const repo = {
    findLiveTaskByRoom: vi.fn().mockResolvedValue(liveTask),
    transition: vi.fn(async () => ({ id: 't1' })),
    listQueue: vi.fn(),
    findPaginated: vi.fn(),
    findById: vi.fn(),
    uncheckedItems: vi.fn().mockResolvedValue(uncheckedItems),
  } as any;
  return { svc: new HousekeepingService(repo), repo };
}

const meta = { userId: 'u1', requestId: 'r1' };

describe('HousekeepingService turn workflow', () => {
  it('start: OPEN -> CLEANING, marking the unit CLEANING and stamping the cleaner', async () => {
    const { svc, repo } = setup({ id: 't1', status: 'OPEN', assigned_to: null, notes: null });
    await svc.start('rm1', { assigned_to: 'hk1' } as any, meta);
    expect(repo.transition).toHaveBeenCalledWith(
      't1', 'rm1', 'OPEN',
      expect.objectContaining({ status: 'CLEANING', assigned_to: 'hk1', started_by: 'u1' }),
      'CLEANING', meta
    );
  });

  it('inspect: CLEANING -> INSPECTED, stamping the validating supervisor', async () => {
    const { svc, repo } = setup({ id: 't1', status: 'CLEANING', assigned_to: 'hk1', notes: null });
    await svc.inspect('rm1', {} as any, meta);
    expect(repo.transition).toHaveBeenCalledWith(
      't1', 'rm1', 'CLEANING',
      expect.objectContaining({ status: 'INSPECTED', inspected_by: 'u1' }),
      'INSPECTED', meta
    );
  });

  it('ready: INSPECTED -> DONE, marking the unit READY and stamping the sign-off', async () => {
    const { svc, repo } = setup({ id: 't1', status: 'INSPECTED', assigned_to: 'hk1', notes: null });
    await svc.ready('rm1', {} as any, meta);
    expect(repo.transition).toHaveBeenCalledWith(
      't1', 'rm1', 'INSPECTED',
      expect.objectContaining({ status: 'DONE', signed_off_by: 'u1' }),
      'READY', meta
    );
  });

  it('inspect is blocked while active checklist items are unticked (compliance gate)', async () => {
    const { svc, repo } = setup(
      { id: 't1', status: 'CLEANING', assigned_to: 'hk1', notes: null },
      [{ id: 'i1', label: 'Bathroom cleaned and sanitised' }],
    );
    const err = await svc.inspect('rm1', {} as any, meta).catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('Checklist incomplete');
    expect(err.message).toContain('Bathroom cleaned');
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('rejects a transition out of order (start requires OPEN)', async () => {
    const { svc, repo } = setup({ id: 't1', status: 'CLEANING' });
    await expect(svc.start('rm1', {} as any, meta)).rejects.toThrow('expected OPEN');
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('404s when the unit has no live task', async () => {
    const { svc } = setup(undefined);
    await expect(svc.ready('rm1', {} as any, meta)).rejects.toThrow('No live housekeeping task');
  });
});
