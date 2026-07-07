import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Mock the data hooks: segments load (LLM dark), campaign/strategy are idle mutations.
vi.mock('./hooks', () => ({
  useSegments: () => ({
    data: {
      configured: false,
      total_customers: 42,
      segments: [
        { key: 'vip', label: 'VIP', description: 'Top spenders.', count: 5, total_spend: 10_000_000, avg_spend: 2_000_000, sample_names: ['Kagiso Holdings'] },
        { key: 'prospect', label: 'Prospects', description: 'Not stayed yet.', count: 10, total_spend: 0, avg_spend: 0, sample_names: [] },
      ],
    },
    isLoading: false, isError: false, refetch: () => {},
  }),
  useGenerateCampaign: () => ({ mutate: () => {}, reset: () => {}, isPending: false, isError: false, data: undefined }),
  useStrategy: () => ({ mutate: () => {}, isPending: false, isError: false, data: undefined }),
}));

import { MarketingPage } from './MarketingPage';

describe('MarketingPage', () => {
  it('renders segments and the dark-state banner when the LLM is not configured', () => {
    render(<MarketingPage />);
    expect(screen.getByRole('heading', { name: /Marketing & Strategy/ })).toBeInTheDocument();
    // LLM dark → banner explains that generation is off.
    expect(screen.getByText('AI is switched off')).toBeInTheDocument();
    // Deterministic segments still render.
    expect(screen.getByText('Guest segments')).toBeInTheDocument();
    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.getByText('Prospects')).toBeInTheDocument();
    expect(screen.getByText('Kagiso Holdings')).toBeInTheDocument();
    expect(screen.getByText('AI strategy brief')).toBeInTheDocument();
  });
});
