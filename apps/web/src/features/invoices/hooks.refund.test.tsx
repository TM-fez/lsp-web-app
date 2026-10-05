import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';

// (R9 #2) A refund made from an open booking left that booking still showing the money and
// the refund form until it was closed and reopened: only the invoice list was refreshed.
// A refund changes the booking's money and the "cancelled with money held" list too.

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: { post } }));
vi.mock('@/store/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { useRefundInvoice } from './hooks';

describe('useRefundInvoice', () => {
  it('refreshes the booking’s money and the finance lists, not only invoices', async () => {
    post.mockResolvedValue({ data: { id: 'cn1' }, headers: {} });
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useRefundInvoice(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 'rcpt-1', amount: 1_000, reason: 'x' }));
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(['invoices']));
    expect(keys).toContain(JSON.stringify(['reservations']));
    expect(keys).toContain(JSON.stringify(['finance']));
  });
});
