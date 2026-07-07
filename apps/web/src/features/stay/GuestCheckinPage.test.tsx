import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

// Mock the public API: an active stay that hasn't self-checked-in yet.
vi.mock('@/lib/api/public', () => ({
  getCheckinInfo: vi.fn().mockResolvedValue({
    property_name: 'Village', unit_name: 'Garden Suite', unit_code: '101',
    has_stay: true, check_out_date: '2026-07-10', already_checked_in: false,
  }),
  submitCheckin: vi.fn(),
}));

import { GuestCheckinPage } from './GuestCheckinPage';

const renderAt = (path: string) =>
  render(<MemoryRouter initialEntries={[path]}><GuestCheckinPage /></MemoryRouter>);

describe('GuestCheckinPage', () => {
  it('welcomes the guest and shows a details form for an active stay', async () => {
    renderAt('/stay/checkin?t=tok-123');
    expect(await screen.findByText(/Welcome to Garden Suite/)).toBeInTheDocument();
    expect(screen.getByText('Village', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Full name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm my details/ })).toBeInTheDocument();
  });

  it('prompts to scan the QR when there is no token', () => {
    renderAt('/stay/checkin');
    expect(screen.getByText(/scan the QR code in your apartment/i)).toBeInTheDocument();
  });
});
