import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// A VIP list mixing a migrated guest (stays but no recorded spend or dates) with one who
// booked and paid in LSP — the two cases the row has to tell apart honestly.
vi.mock('./hooks', () => ({
  useSegmentMembers: () => ({
    data: {
      key: 'vip',
      label: 'VIP',
      total: 2,
      truncated: false,
      members: [
        {
          id: 'a', name: 'University of Pennsylvania', company: null, phone: '77135784',
          email: null, stays: 0, previous_stays: 100, total_stays: 100, spend: 0,
          last_stay_days: null,
        },
        {
          id: 'b', name: 'Kagiso Holdings', company: 'Kagiso', phone: '+267 71 000 000',
          email: 'kagiso@example.com', stays: 6, previous_stays: 0, total_stays: 6,
          spend: 2_500_000, last_stay_days: 12,
        },
      ],
    },
    isLoading: false, isError: false, refetch: () => {},
  }),
}));

import { SegmentMembers } from './SegmentMembers';

describe('SegmentMembers', () => {
  it('leads with the phone number and makes it dialable', () => {
    render(<SegmentMembers segment="vip" label="VIP" />);
    const call = screen.getByRole('link', { name: /77135784/ });
    expect(call).toHaveAttribute('href', 'tel:77135784');
  });

  it('says a migrated guest’s spend is not recorded rather than showing zero', () => {
    render(<SegmentMembers segment="vip" label="VIP" />);
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();      // no last-stay date either
    expect(screen.getByText('100 imported')).toBeInTheDocument(); // where the stays came from
  });

  it('shows real spend and recency for a guest who booked here', () => {
    render(<SegmentMembers segment="vip" label="VIP" />);
    expect(screen.getByText('12 days ago')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'kagiso@example.com' })).toBeInTheDocument();
  });

  it('offers the list as a download for whoever makes the calls', () => {
    render(<SegmentMembers segment="vip" label="VIP" />);
    expect(screen.getByRole('button', { name: /Download list/ })).toBeInTheDocument();
  });
});
