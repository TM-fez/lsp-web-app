import { describe, it, expect } from 'vitest';
import { computePropertyScope } from '../../../src/core/scope/propertyScope.js';

// "Can see every property" decides who may see company-level (no-property) data.
describe('computePropertyScope', () => {
  const ACTIVE = ['village', 'cbd'];

  it('admin sees everything regardless of memberships', () => {
    expect(computePropertyScope('admin', [], ACTIVE)).toEqual({ ids: null, allProperties: true });
  });

  it('a member of every active property counts as all-property', () => {
    expect(computePropertyScope('accounts', ['cbd', 'village'], ACTIVE)).toEqual({ ids: ['cbd', 'village'], allProperties: true });
  });

  it('a member of only some properties is limited', () => {
    expect(computePropertyScope('accounts', ['cbd'], ACTIVE)).toEqual({ ids: ['cbd'], allProperties: false });
  });

  it('a user with no memberships is limited (and sees nothing)', () => {
    expect(computePropertyScope('reception', [], ACTIVE)).toEqual({ ids: [], allProperties: false });
  });

  it('a newly opened property makes a two-property user limited until they are added', () => {
    expect(computePropertyScope('accounts', ['cbd', 'village'], [...ACTIVE, 'airport']).allProperties).toBe(false);
  });

  it('with no active properties at all nobody but admin is all-property', () => {
    expect(computePropertyScope('accounts', [], []).allProperties).toBe(false);
  });
});
