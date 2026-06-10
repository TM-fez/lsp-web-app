import { describe, it, expect } from 'vitest';
import { nextAction, isClosed, statusTone, priorityTone, priorityLabel, fmtDate } from './util';

describe('nextAction (status -> the one valid lifecycle step)', () => {
  it('routes each status to its only legal action', () => {
    expect(nextAction.OPEN).toBe('start');
    expect(nextAction.IN_PROGRESS).toBe('complete');
    expect(nextAction.BLOCKED).toBe('complete');
    expect(nextAction.COMPLETED).toBeNull();
    expect(nextAction.CANCELLED).toBeNull();
  });
});

describe('isClosed', () => {
  it('is true only for COMPLETED and CANCELLED', () => {
    expect(isClosed('COMPLETED')).toBe(true);
    expect(isClosed('CANCELLED')).toBe(true);
    expect(isClosed('OPEN')).toBe(false);
    expect(isClosed('IN_PROGRESS')).toBe(false);
    expect(isClosed('BLOCKED')).toBe(false);
  });
});

describe('tone maps cover every enum value', () => {
  it('has a tone for each status and priority', () => {
    expect(Object.keys(statusTone)).toHaveLength(5);
    expect(Object.keys(priorityTone)).toHaveLength(4);
  });
});

describe('priorityLabel / fmtDate', () => {
  it('title-cases the priority', () => {
    expect(priorityLabel('CRITICAL')).toBe('Critical');
    expect(priorityLabel('LOW')).toBe('Low');
  });
  it('formats valid dates and tolerates bad input', () => {
    expect(fmtDate('2026-06-09T10:00:00.000Z')).not.toBe('—');
    expect(fmtDate('nope')).toBe('—');
  });
});
