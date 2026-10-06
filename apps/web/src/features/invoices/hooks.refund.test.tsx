import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';

// (R9 #2) A refund made from an open booking left that booking still showing the money and
// the refund form until it was closed and reopened: only the invoice list was refreshed.
// A refund changes the booking's money and the "cancelled with money held" list too.

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: { post } }));
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('@/store/toast', () => ({ toast: { success: vi.fn(), error: toastError, info: vi.fn() } }));

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

  // (R10 #6) A refused refund (409) left the screen offering the figure that was just refused.
  it('refreshes after a refused refund too, and leaves the "makes the stay free" question to the screen', async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useRefundInvoice(), { wrapper });

    toastError.mockClear();
    post.mockRejectedValueOnce({ response: { status: 409, data: { error: 'Conflict', message: 'Only BWP 1.00 of this invoice is left to refund.' } } });
    await act(() => result.current.mutateAsync({ id: 'rcpt-1', amount: 1_000, reason: 'x' }).catch(() => {}));
    expect(spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(JSON.stringify(['reservations']));
    expect(toastError).toHaveBeenCalledWith('Only BWP 1.00 of this invoice is left to refund.');

    toastError.mockClear();
    post.mockRejectedValueOnce({ response: { status: 409, data: { error: 'Full Refund', message: 'makes the stay free' } } });
    await act(() => result.current.mutateAsync({ id: 'rcpt-1', amount: 1_000, reason: 'x' }).catch(() => {}));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('sends the answer to the question only when given', async () => {
    post.mockResolvedValue({ data: { id: 'cn1' }, headers: {} });
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useRefundInvoice(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 'rcpt-1', amount: 1_000, reason: 'x' }));
    expect(post.mock.calls.at(-1)![1]).toEqual({ amount: 1_000, reason: 'x' });
    await act(() => result.current.mutateAsync({ id: 'rcpt-1', amount: 1_000, reason: 'x', confirmFullRefund: true }));
    expect(post.mock.calls.at(-1)![1]).toEqual({ amount: 1_000, reason: 'x', confirm_full_refund: true });
  });
});
