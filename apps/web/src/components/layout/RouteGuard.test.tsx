import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { useAuthStore } from '@/store/auth';
import { RouteGuard } from './RouteGuard';

// Re-test 2026-10-04: staff could open finance/admin screens by typing the URL and got an
// empty shell or "the server didn't respond". The data was already refused; the screen
// now says plainly that the page isn't theirs.

const as = (permissions: string[]) =>
  useAuthStore.setState({ accessToken: 't', user: { id: 'u', name: 'X', email: 'x@x', role: 'housekeeping', permissions } as never });

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <RouteGuard><p>the page</p></RouteGuard>
    </MemoryRouter>
  );

describe('RouteGuard', () => {
  it('shows "no access" instead of the screen when the role lacks its permission', () => {
    as(['housekeeping.read']);
    at('/payroll');
    expect(screen.getByText('You don’t have access to this page')).toBeInTheDocument();
    expect(screen.queryByText('the page')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to my home page' })).toHaveAttribute('href', '/housekeeping');
  });

  it('shows the screen when the role has it', () => {
    as(['payroll.read']);
    at('/payroll');
    expect(screen.getByText('the page')).toBeInTheDocument();
  });

  it('never blocks Settings — everyone may change their own password', () => {
    as([]);
    at('/settings');
    expect(screen.getByText('the page')).toBeInTheDocument();
  });
});
