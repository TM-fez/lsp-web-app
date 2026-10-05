import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

// (R6 item 20) A double click on "Add guest" made one guest (the server replays the second
// request) but showed "Guest added" twice. A replayed answer adds nothing, so it says nothing.

const { post, push } = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: { post } }));
vi.mock('@/store/toast', () => ({
  toast: { success: (m: string) => push('success', m), error: (m: string) => push('error', m), info: (m: string) => push('info', m) },
}));

import { useCreateGuest } from './hooks';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useCreateGuest', () => {
  beforeEach(() => { post.mockReset(); push.mockReset(); });

  it('says "Guest added" once for a new guest', async () => {
    post.mockResolvedValue({ data: { id: 'c1' }, headers: {} });
    const { result } = renderHook(() => useCreateGuest(), { wrapper });
    await act(() => result.current.mutateAsync({ input: { name: 'Neo' } as never, idempotencyKey: 'k' }));
    expect(push).toHaveBeenCalledWith('success', 'Guest added');
  });

  it('stays quiet when the server replays the same add', async () => {
    post.mockResolvedValue({ data: { id: 'c1' }, headers: { 'idempotent-replayed': 'true' } });
    const { result } = renderHook(() => useCreateGuest(), { wrapper });
    await act(() => result.current.mutateAsync({ input: { name: 'Neo' } as never, idempotencyKey: 'k' }));
    expect(push).not.toHaveBeenCalled();
  });
});
