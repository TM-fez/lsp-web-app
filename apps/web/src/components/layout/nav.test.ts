import { describe, it, expect } from 'vitest';
import { workspaceForPath, landingRoute, WORKSPACE_PLACEHOLDER } from './nav';

describe('workspaceForPath', () => {
  it('maps built routes to their workspace', () => {
    expect(workspaceForPath('/')).toBe('OPERATIONS');
    expect(workspaceForPath('/guests')).toBe('OPERATIONS');
    expect(workspaceForPath('/rooms')).toBe('ADMIN');
    expect(workspaceForPath('/pricing')).toBe('ADMIN');
  });

  it('keeps the Finance placeholder in the Finance workspace', () => {
    expect(workspaceForPath('/finance')).toBe('FINANCE');
  });

  it('matches nested detail paths by prefix', () => {
    expect(workspaceForPath('/guests/123')).toBe('OPERATIONS');
  });

  it('does not let "/" swallow other routes', () => {
    // The root Cockpit route must match exactly, not as a prefix of everything.
    expect(workspaceForPath('/rooms')).toBe('ADMIN');
  });

  it('falls back to the default workspace for unknown paths', () => {
    expect(workspaceForPath('/nope')).toBe('OPERATIONS');
  });
});

describe('landingRoute', () => {
  const all = () => true;
  const none = () => false;

  it('lands on the first built + permitted screen', () => {
    expect(landingRoute('OPERATIONS', all)).toBe('/');
    expect(landingRoute('ADMIN', all)).toBe('/rooms');
  });

  it('falls back to the placeholder when nothing is built', () => {
    expect(landingRoute('FINANCE', all)).toBe('/finance');
    expect(landingRoute('FINANCE', all)).toBe(WORKSPACE_PLACEHOLDER.FINANCE);
  });

  it('skips screens the user lacks permission for', () => {
    const onlyGuests = (p: string) => p === 'crm.contacts.read';
    expect(landingRoute('OPERATIONS', onlyGuests)).toBe('/guests');
  });

  it('still resolves a built route even with no permissions', () => {
    expect(landingRoute('OPERATIONS', none)).toBe('/');
  });
});
