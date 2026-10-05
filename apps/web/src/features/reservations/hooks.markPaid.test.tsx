import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

// (R6 NEW-1) An identical second "record payment" within 10 s is replayed by the server
// (200 + Idempotent-Replayed: true) and records NOTHING — but the clerk saw "Payment
// recorded" a second time and could believe two payments went in. A replay now says so.

const { post, push } = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: { post } }));
vi.mock('@/store/toast', () => ({
  toast: { success: (m: string) => push('success', m), error: (m: string) => push('error', m), info: (m: string) => push('info', m) },
}));

import { useMarkPaid } from './hooks';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useMarkPaid', () => {
  beforeEach(() => { post.mockReset(); push.mockReset(); });

  it('a first payment says "Payment recorded"', async () => {
    post.mockResolvedValue({ data: { id: 'r1' }, headers: {} });
    const { result } = renderHook(() => useMarkPaid(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 'r1', input: { method: 'CASH' } as never }));
    expect(push).toHaveBeenCalledWith('success', 'Payment recorded');
  });

  it('a replayed duplicate says it was already recorded — never "Payment recorded" again', async () => {
    post.mockResolvedValue({ data: { id: 'r1' }, headers: { 'idempotent-replayed': 'true' } });
    const { result } = renderHook(() => useMarkPaid(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 'r1', input: { method: 'CASH' } as never }));
    expect(push).toHaveBeenCalledWith('info', 'This payment was already recorded a moment ago — nothing new was added.');
    expect(push).not.toHaveBeenCalledWith('success', 'Payment recorded');
  });
});
