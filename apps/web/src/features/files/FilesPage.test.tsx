import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LibraryFile } from '@/lib/api/files';
import { useAuthStore } from '@/store/auth';

// The library's job: every file under a plain-English category, a way back to the record
// it belongs to, and guest ID copies kept out of sight for people who may not see them.

const row = (over: Partial<LibraryFile>): LibraryFile => ({
  id: 'f1', original_name: 'file.pdf', mime_type: 'application/pdf', size_bytes: 2048,
  created_at: '2026-09-01T08:00:00Z', created_by: 'u1', uploaded_by_name: 'Neo Kgosi',
  category: 'UNFILED', link_kind: null, link_id: null, link_label: null,
  property_id: null, property_name: null, ...over,
});

const rows: LibraryFile[] = [
  row({ id: 'r', original_name: 'receipt.pdf', category: 'INCOME_RECEIPTS', link_kind: 'invoice', link_id: 'i1', link_label: 'INV-00042', property_name: 'Village' }),
  row({ id: 'c', original_name: 'lease-B2.pdf', category: 'CONTRACTS' }),
];

const lastParams = vi.fn();
vi.mock('./hooks', () => ({
  useFilesLibrary: (params: unknown) => {
    lastParams(params);
    return { data: { data: rows, total: rows.length, page: 1, limit: 50 }, isLoading: false, isError: false, refetch: () => {} };
  },
  useUploadDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
const api = vi.hoisted(() => ({ downloadFile: vi.fn(), openFile: vi.fn() }));
vi.mock('@/lib/api/files', async (orig) => ({ ...(await orig<object>()), ...api }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('@/store/toast', () => ({ toast: { error: toastError, success: vi.fn(), info: vi.fn() } }));
vi.mock('@/features/auth/useMyProperties', () => ({ useMyProperties: () => ({ data: [{ id: 'p1', name: 'Village' }] }) }));

import { FilesPage } from './FilesPage';

const renderPage = () => render(<MemoryRouter><FilesPage /></MemoryRouter>);
const withPerms = (permissions: string[]) =>
  useAuthStore.setState({ accessToken: 't', user: { id: 'u1', name: 'X', email: 'x@x', role: 'reception', permissions } as never });

describe('FilesPage', () => {
  beforeEach(() => lastParams.mockClear());

  it('shows each file under its category, linked back to what it belongs to', () => {
    withPerms(['files.read']);
    renderPage();
    expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
    expect(screen.getAllByText('Receipts — income').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Invoice · INV-00042' })).toHaveAttribute('href', '/invoices');
    expect(screen.getByText('lease-B2.pdf')).toBeInTheDocument();
  });

  it('hides the Guest documents tab from people who may not see ID copies', () => {
    withPerms(['files.read']);
    renderPage();
    expect(screen.queryByRole('button', { name: /Guest documents/ })).not.toBeInTheDocument();
  });

  it('shows it to front desk / admin', () => {
    withPerms(['files.read', 'files.guest_documents.read']);
    renderPage();
    expect(screen.getByRole('button', { name: /Guest documents/ })).toBeInTheDocument();
  });

  it('asks the server for the chosen category', () => {
    withPerms(['files.read']);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Contracts' }));
    expect(lastParams).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'CONTRACTS' }));
  });

  it('only offers Upload to people who can upload', () => {
    withPerms(['files.read']);
    renderPage();
    expect(screen.queryByRole('button', { name: /Upload document/ })).not.toBeInTheDocument();
    withPerms(['files.read', 'files.create']);
    renderPage();
    expect(screen.getByRole('button', { name: /Upload document/ })).toBeInTheDocument();
  });

  // Round 4: the UI tester saw no Download — the library was empty. Every row carries one.
  it('offers Download and Open on every file row, and saves under the original name', () => {
    withPerms(['files.read']);
    renderPage();
    const downloads = screen.getAllByRole('button', { name: /Download/ });
    expect(downloads).toHaveLength(rows.length);
    expect(screen.getAllByRole('button', { name: /Open/ })).toHaveLength(rows.length);
    fireEvent.click(downloads[1]!);
    expect(api.downloadFile).toHaveBeenCalledWith('c', 'lease-B2.pdf');
  });

  it('tells the person when a download fails instead of failing silently', async () => {
    api.downloadFile.mockRejectedValueOnce(new Error('network down'));
    withPerms(['files.read']);
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: /Download/ })[0]!);
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
