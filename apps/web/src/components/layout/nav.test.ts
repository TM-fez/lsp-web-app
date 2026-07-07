import { describe, it, expect } from 'vitest';
import { workspaceForPath, landingRoute } from './nav';

describe('workspaceForPath', () => {
  it('maps built routes to their workspace', () => {
    expect(workspaceForPath('/')).toBe('OPERATIONS');
    expect(workspaceForPath('/guests')).toBe('OPERATIONS');
    expect(workspaceForPath('/rooms')).toBe('ADMIN');
    expect(workspaceForPath('/pricing')).toBe('ADMIN');
  });

  it('maps the Finance Cockpit route to the Finance workspace', () => {
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
    expect(landingRoute('ADMIN', all)).toBe('/properties');
  });

  it('lands on Finance’s first built screen (Cockpit)', () => {
    expect(landingRoute('FINANCE', all)).toBe('/finance');
    // A user without reports.read skips the Cockpit and lands on Invoices instead.
    const noReports = (p: string) => p !== 'reports.read';
    expect(landingRoute('FINANCE', noReports)).toBe('/invoices');
  });

  it('skips screens the user lacks permission for', () => {
    const onlyGuests = (p: string) => p === 'crm.contacts.read';
    expect(landingRoute('OPERATIONS', onlyGuests)).toBe('/guests');
  });

  it('still resolves a built route even with no permissions', () => {
    expect(landingRoute('OPERATIONS', none)).toBe('/');
  });
});
