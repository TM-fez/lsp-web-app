import { describe, it, expect } from 'vitest';
import { nextAction, actionLabel, turnResult, HK_STATUSES, hkLabel } from './util';

describe('housekeeping turn workflow', () => {
  it('maps each status to the correct next action', () => {
    expect(nextAction.DIRTY).toBe('start');
    expect(nextAction.CLEANING).toBe('inspect');
    expect(nextAction.INSPECTED).toBe('ready');
    expect(nextAction.READY).toBeNull();
  });

  it('every action has a label and a result message', () => {
    (['start', 'inspect', 'ready'] as const).forEach((a) => {
      expect(actionLabel[a]).toBeTruthy();
      expect(turnResult[a]).toBeTruthy();
    });
  });

  it('labels statuses readably and covers all four', () => {
    expect(hkLabel('DIRTY')).toBe('Dirty');
    expect(hkLabel('INSPECTED')).toBe('Inspected');
    expect(HK_STATUSES).toEqual(['DIRTY', 'CLEANING', 'INSPECTED', 'READY']);
  });
});
