import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';

// Keep the network out of the render smoke test.
vi.mock('@/lib/api/auth', () => ({ login: vi.fn(), logout: vi.fn() }));

describe('LoginPage', () => {
  it('renders the sign-in form with prefilled dev credentials', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('admin@lsp.local');
    expect(screen.getByLabelText('Password')).toHaveValue('Admin@123!');
  });
});
