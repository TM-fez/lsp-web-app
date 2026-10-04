import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { useAuthStore } from '@/store/auth';
import { ROLE_PERMISSIONS, ROLES } from '@/test/rolePermissions';

// The shell's chrome and the cockpit are not what is under test — only who gets the page.
vi.mock('@/components/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/layout/Topbar', () => ({ Topbar: () => null }));
vi.mock('@/features/cockpit/CockpitPage', () => ({ CockpitPage: () => <p>the cockpit</p> }));

import { router } from './index';
import { AppShell } from '@/components/layout/AppShell';
import { RouteGuard } from '@/components/layout/RouteGuard';
import { HomeRoute } from './HomeRoute';
import { permForPath } from '@/components/layout/nav';

/**
 * (Round 4, item 9) A browser tester believed housekeeping / maintenance / contractor /
 * operations could open Finance, Settings, Properties and Users by URL. The server already
 * refuses their data; this proves the SCREEN says so too, for every route and every role:
 *   1. every route in router/index.tsx is accounted for below (a new route fails this test
 *      until someone decides what it needs);
 *   2. every signed-in route is wrapped by a RouteGuard (directly, or via the AppShell);
 *   3. for every route × role the guard either shows the page or the "no access" page, and
 *      never lets a role into a page whose API it cannot call (an empty shell);
 *   4. a role that can open nothing at all gets the "no access" page at `/`, not the cockpit.
 *
 * `api` = the permission the page's main request needs on the server (routes.txt / *.routes.ts);
 * null = open to any signed-in user (Settings: your own password).
 */
const PROTECTED: Record<string, { sample: string; api: string | null }> = {
  '/invoices/:id/print': { sample: '/invoices/1/print', api: 'invoices.read' },
  '/reports/print': { sample: '/reports/print', api: 'reports.read' },
  '/owners/print': { sample: '/owners/print', api: 'reports.read' },
  '/housekeeping/board': { sample: '/housekeeping/board', api: 'housekeeping.read' },
  '/reservations': { sample: '/reservations', api: 'reservations.read' },
  '/leads': { sample: '/leads', api: 'crm.leads.read' },
  '/guests': { sample: '/guests', api: 'crm.contacts.read' },
  '/housekeeping': { sample: '/housekeeping', api: 'housekeeping.read' },
  '/housekeeping/all': { sample: '/housekeeping/all', api: 'housekeeping.read' },
  '/maintenance': { sample: '/maintenance', api: 'maintenance.read' },
  '/maintenance/all': { sample: '/maintenance/all', api: 'maintenance.read' },
  '/properties': { sample: '/properties', api: 'properties.read' },
  '/rooms': { sample: '/rooms', api: 'rooms.read' },
  '/pricing': { sample: '/pricing', api: 'pricing.read' },
  '/users': { sample: '/users', api: 'users.read' },
  '/expenses': { sample: '/expenses', api: 'expenses.read' },
  '/reports': { sample: '/reports', api: 'reports.read' },
  '/owners': { sample: '/owners', api: 'reports.read' },
  '/operations': { sample: '/operations', api: 'reports.read' },
  '/marketing': { sample: '/marketing', api: 'reports.read' },
  '/invoices': { sample: '/invoices', api: 'invoices.read' },
  '/payments': { sample: '/payments', api: 'payments.read' },
  '/operating-expenses': { sample: '/operating-expenses', api: 'opex.read' },
  '/payroll': { sample: '/payroll', api: 'payroll.read' },
  '/finance': { sample: '/finance', api: 'invoices.read' },
  '/files': { sample: '/files', api: 'files.library' },
  '/settings': { sample: '/settings', api: null },
};
// '/' is handled by HomeRoute (section 4). Pages that open to the public or just redirect:
const PUBLIC = ['/login', '/stay', '/stay/manage', '/stay/checkin', '/enquire'];
const REDIRECTS = ['/owner-statements', '*'];
// Properties is deliberately stricter than its API: reading the list is open to many roles
// (the picker), but the setup SCREEN is admin work (properties.update).
const STRICTER_THAN_API = new Set(['/properties']);

interface Leaf { path: string; element: ReactElement; layouts: ReactElement[] }
type RouteObj = { path?: string; element?: ReactElement; children?: RouteObj[] };

function leaves(routes: RouteObj[], layouts: ReactElement[] = []): Leaf[] {
  return routes.flatMap((r) => {
    const next = r.element && !r.path ? [...layouts, r.element] : layouts;
    if (r.children) return leaves(r.children, next);
    return r.path && r.element ? [{ path: r.path, element: r.element, layouts }] : [];
  });
}
const all = leaves(router.routes as unknown as RouteObj[]);

const signIn = (role: string) =>
  useAuthStore.setState({
    accessToken: 't',
    user: { id: 'u', name: 'X', email: 'x@x', role, permissions: ROLE_PERMISSIONS[role] ?? [] } as never,
  });

beforeEach(() => useAuthStore.setState({ accessToken: null, user: null }));

describe('every route is accounted for', () => {
  it('knows each route in the router (a new route must be added to this test)', () => {
    const known = new Set([...Object.keys(PROTECTED), '/', ...PUBLIC, ...REDIRECTS]);
    const unknown = all.map((l) => l.path).filter((p) => !known.has(p));
    expect(unknown).toEqual([]);
  });

  it('lists no route that has been removed from the router', () => {
    const present = new Set(all.map((l) => l.path));
    expect(Object.keys(PROTECTED).filter((p) => !present.has(p))).toEqual([]);
  });

  it('wraps every signed-in page in a RouteGuard, directly or through the AppShell', () => {
    const unguarded = all
      .filter((l) => l.path in PROTECTED)
      .filter((l) => l.element.type !== RouteGuard && !l.layouts.some((x) => x.type === AppShell))
      .map((l) => l.path);
    expect(unguarded).toEqual([]);
  });
});

describe('the AppShell guards what it frames', () => {
  it('shows "no access" instead of the page inside the shell', () => {
    signIn('housekeeping');
    render(
      <MemoryRouter initialEntries={['/payroll']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/payroll" element={<p>payroll page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('You don’t have access to this page')).toBeInTheDocument();
    expect(screen.queryByText('payroll page')).not.toBeInTheDocument();
  });
});

describe.each(ROLES)('role %s', (role) => {
  const perms = ROLE_PERMISSIONS[role]!;

  it.each(Object.entries(PROTECTED))('%s: shows the page or a no-access page, never an empty shell', (pattern, { sample, api }) => {
    signIn(role);
    render(
      <MemoryRouter initialEntries={[sample]}>
        <RouteGuard><p>the page</p></RouteGuard>
      </MemoryRouter>
    );
    const opened = screen.queryByText('the page') !== null;
    const denied = screen.queryByText('You don’t have access to this page') !== null;
    expect(opened !== denied).toBe(true); // exactly one of the two

    const guardPerm = permForPath(sample);
    expect(opened).toBe(!guardPerm || perms.includes(guardPerm));
    // The page must never open for a role whose server calls would be refused.
    if (opened && api) expect(perms).toContain(api);
    // …and a role the server would serve is only turned away on purpose.
    if (!opened && api && perms.includes(api)) expect(STRICTER_THAN_API.has(pattern)).toBe(true);
  });
});

describe('the home route', () => {
  it.each(ROLES)('%s lands on the cockpit or a page of their own — never a blank shell', (role) => {
    signIn(role);
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="*" element={<p>redirected</p>} />
        </Routes>
      </MemoryRouter>
    );
    const hasCockpit = ROLE_PERMISSIONS[role]!.includes('cockpit.read');
    expect(screen.getByText(hasCockpit ? 'the cockpit' : 'redirected')).toBeInTheDocument();
  });

  it('a role that can open nothing at all gets the no-access page, not the cockpit', () => {
    signIn('nobody');
    render(<MemoryRouter initialEntries={['/']}><HomeRoute /></MemoryRouter>);
    expect(screen.getByText('You don’t have access to this page')).toBeInTheDocument();
    expect(screen.queryByText('the cockpit')).not.toBeInTheDocument();
  });
});
