import { describe, it, expect } from 'vitest';
import { nextAction, actionLabel, turnResult, canDoAction, HK_STATUSES, hkLabel } from './util';

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

  it('gates each stage by its permission (three-stage flow)', () => {
    const withPerms = (...perms: string[]) => (p: string) => perms.includes(p);

    const cleaner = withPerms('housekeeping.read', 'housekeeping.update');
    expect(canDoAction('start', cleaner)).toBe(true);
    expect(canDoAction('inspect', cleaner)).toBe(false); // can't validate own clean
    expect(canDoAction('ready', cleaner)).toBe(false); // can't sign off

    const supervisor = withPerms('housekeeping.read', 'housekeeping.update', 'housekeeping.inspect');
    expect(canDoAction('inspect', supervisor)).toBe(true);
    expect(canDoAction('ready', supervisor)).toBe(false);

    const manager = withPerms('housekeeping.read', 'housekeeping.signoff');
    expect(canDoAction('ready', manager)).toBe(true);
    expect(canDoAction('start', manager)).toBe(false); // managers sign off, cleaners clean
  });
});
