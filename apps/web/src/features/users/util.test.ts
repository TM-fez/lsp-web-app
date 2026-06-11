import { describe, it, expect } from 'vitest';
import {
  ROLE_OPTIONS,
  roleTone,
  roleLabel,
  roleHint,
  canTakeReceptionHat,
  hasReceptionHat,
  buildExtraPermissions,
  passwordIssue,
  LEAD_INSPECT_PERM,
} from './util';

const RECEPTION_PERMS = ['reservations.read', 'reservations.create', 'crm.contacts.read'];

describe('role maps cover every role', () => {
  it('has a tone, label and hint for each role option', () => {
    for (const r of ROLE_OPTIONS) {
      expect(roleTone[r]).toBeTruthy();
      expect(roleLabel[r]).toBeTruthy();
      expect(roleHint[r]).toBeTruthy();
    }
  });
});

describe('canTakeReceptionHat', () => {
  it('is false for roles that already cover the front desk', () => {
    expect(canTakeReceptionHat('admin')).toBe(false);
    expect(canTakeReceptionHat('operations')).toBe(false);
    expect(canTakeReceptionHat('reception')).toBe(false);
  });
  it('is true for housekeeping, maintenance and accounts', () => {
    expect(canTakeReceptionHat('housekeeping')).toBe(true);
    expect(canTakeReceptionHat('maintenance')).toBe(true);
    expect(canTakeReceptionHat('accounts')).toBe(true);
  });
});

describe('hasReceptionHat', () => {
  it('requires the full reception pack, not a partial overlap', () => {
    expect(hasReceptionHat([...RECEPTION_PERMS, 'extra.perm'], RECEPTION_PERMS)).toBe(true);
    expect(hasReceptionHat(['reservations.read'], RECEPTION_PERMS)).toBe(false);
    expect(hasReceptionHat([], RECEPTION_PERMS)).toBe(false);
  });
  it('is false when the reception pack is unknown (still loading)', () => {
    expect(hasReceptionHat(['anything'], [])).toBe(false);
  });
});

describe('buildExtraPermissions', () => {
  it('housekeeping lead gets the inspect grant', () => {
    const extras = buildExtraPermissions({
      role: 'housekeeping',
      isLead: true,
      coversReception: false,
      receptionPerms: RECEPTION_PERMS,
    });
    expect(extras).toEqual([LEAD_INSPECT_PERM]);
  });

  it('second hat adds the reception pack on top', () => {
    const extras = buildExtraPermissions({
      role: 'housekeeping',
      isLead: true,
      coversReception: true,
      receptionPerms: RECEPTION_PERMS,
    });
    for (const p of RECEPTION_PERMS) expect(extras).toContain(p);
    expect(extras).toContain(LEAD_INSPECT_PERM);
  });

  it('lead on a non-housekeeping role adds nothing (their role already approves)', () => {
    const extras = buildExtraPermissions({
      role: 'operations',
      isLead: true,
      coversReception: false,
      receptionPerms: RECEPTION_PERMS,
    });
    expect(extras).toEqual([]);
  });

  it('reception hat is ignored for roles that already cover the desk', () => {
    const extras = buildExtraPermissions({
      role: 'operations',
      isLead: false,
      coversReception: true,
      receptionPerms: RECEPTION_PERMS,
    });
    expect(extras).toEqual([]);
  });

  it('plain cleaner gets no extras at all', () => {
    const extras = buildExtraPermissions({
      role: 'housekeeping',
      isLead: false,
      coversReception: false,
      receptionPerms: RECEPTION_PERMS,
    });
    expect(extras).toEqual([]);
  });
});

describe('passwordIssue mirrors the API policy', () => {
  it('accepts the seeded-style password', () => {
    expect(passwordIssue('Admin@123!')).toBeNull();
  });
  it('flags each missing ingredient', () => {
    expect(passwordIssue('short')).toBeTruthy();
    expect(passwordIssue('alllowercase1!')).toBeTruthy();
    expect(passwordIssue('ALLUPPERCASE1!')).toBeTruthy();
    expect(passwordIssue('NoNumbers!!')).toBeTruthy();
    expect(passwordIssue('NoSymbols11')).toBeTruthy();
  });
});
