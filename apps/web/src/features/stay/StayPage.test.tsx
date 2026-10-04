import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

// Re-test 2026-10-04: with a typo'd email, zero guests or dates the wrong way round, the
// "Request to book" button just stayed grey. It now says what is missing.

vi.mock('@/lib/api/public', () => ({
  getStayInfo: vi.fn().mockResolvedValue({
    units: [{ unit_type: 'STANDARD', nightly_rate: 50_000, currency: 'BWP', max_guests: 2, min_nights: 1 }],
  }),
  createBooking: vi.fn(),
}));

import { StayPage } from './StayPage';

describe('StayPage', () => {
  it('says why the booking button is disabled', async () => {
    render(<MemoryRouter><StayPage /></MemoryRouter>);
    await screen.findByRole('button', { name: /Request to book/ });
    expect(screen.getByText(/To continue, add your name, add your email, add your phone number\./)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'naledi@' } });
    fireEvent.change(screen.getByLabelText('Guests'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2000-01-01' } });
    const hint = screen.getByText(/To continue/).textContent!;
    expect(hint).toContain('check-out date after check-in');
    expect(hint).toContain('at least 1 guest');
    expect(hint).toContain('check your email address');
  });
});
