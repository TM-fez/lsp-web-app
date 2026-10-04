import { describe, it, expect } from 'vitest';
import { workspaceForPath, landingRoute, homePathFor, permForPath, titleForPath } from './nav';

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

  it('maps Payments to Finance, beside Invoices', () => {
    expect(workspaceForPath('/payments')).toBe('FINANCE');
    expect(workspaceForPath('/invoices')).toBe('FINANCE');
  });

  it('matches nested detail paths by prefix', () => {
    expect(workspaceForPath('/guests/123')).toBe('OPERATIONS');
  });

  it('maps the Operational Cockpit (Trends) route to Operations', () => {
    expect(workspaceForPath('/operations')).toBe('OPERATIONS');
  });

  it('maps the Marketing route to Operations', () => {
    expect(workspaceForPath('/marketing')).toBe('OPERATIONS');
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
    // (R4 3a) The Cockpit follows invoices.read: without it, Cockpit and Invoices are both
    // skipped and the user lands on Payments.
    const noInvoices = (p: string) => p !== 'invoices.read';
    expect(landingRoute('FINANCE', noInvoices)).toBe('/payments');
  });

  it('skips screens the user lacks permission for', () => {
    const onlyGuests = (p: string) => p === 'crm.contacts.read';
    expect(landingRoute('OPERATIONS', onlyGuests)).toBe('/guests');
  });

  it('still resolves a built route even with no permissions', () => {
    expect(landingRoute('OPERATIONS', none)).toBe('/');
  });
});

describe('homePathFor', () => {
  const perms = (...p: string[]) => (perm: string) => p.includes(perm);

  it('keeps the Operations cockpit for anyone who may open it', () => {
    expect(homePathFor(perms('cockpit.read', 'invoices.read'))).toBe('/');
  });

  it('sends accounts (no cockpit.read) to Finance, where most of their screens are', () => {
    expect(homePathFor(perms('reports.read', 'invoices.read', 'payments.read', 'expenses.read'))).toBe('/finance');
    expect(homePathFor(perms('invoices.read', 'payments.read'))).toBe('/finance');
    expect(homePathFor(perms('payments.read'))).toBe('/payments');
  });

  it('sends housekeeping to their own screen, not an admin list', () => {
    expect(homePathFor(perms('housekeeping.read', 'maintenance.read', 'rooms.read'))).toBe('/housekeeping');
  });

  it('returns null when no built screen is permitted', () => {
    expect(homePathFor(perms())).toBeNull();
  });
});

describe('permForPath', () => {
  it('maps a screen, and its sub-pages, to the permission its nav item needs', () => {
    expect(permForPath('/invoices')).toBe('invoices.read');
    expect(permForPath('/invoices/abc/print')).toBe('invoices.read');
    expect(permForPath('/maintenance/all')).toBe('maintenance.read');
    expect(permForPath('/payroll')).toBe('payroll.read');
  });

  it('leaves Settings open to everyone, and / to HomeRoute', () => {
    expect(permForPath('/settings')).toBeNull();
    expect(permForPath('/')).toBeNull();
  });
});

describe('titleForPath', () => {
  it('names the tab after the screen', () => {
    expect(titleForPath('/invoices')).toBe('Invoices · Lifestyle');
    expect(titleForPath('/maintenance/all')).toBe('Maintenance · Lifestyle');
    expect(titleForPath('/finance')).toBe('Cockpit · Finance · Lifestyle');
    expect(titleForPath('/')).toBe('Cockpit · Lifestyle');
    expect(titleForPath('/nowhere')).toBe('Lifestyle Operations');
  });
});
