import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { submitEnquiry, getEnquiryProperties } = vi.hoisted(() => ({
  submitEnquiry: vi.fn(),
  getEnquiryProperties: vi.fn(),
}));
vi.mock('@/lib/api/public', () => ({ submitEnquiry, getEnquiryProperties }));

import { EnquirePage } from './EnquirePage';

const renderAt = (path: string) =>
  render(<MemoryRouter initialEntries={[path]}><EnquirePage /></MemoryRouter>);

describe('EnquirePage', () => {
  beforeEach(() => {
    submitEnquiry.mockReset().mockResolvedValue({ reference: 'ENQ-ABC123' });
    getEnquiryProperties.mockReset().mockResolvedValue([]);
  });

  it('sends an enquiry and shows the reference on success', async () => {
    renderAt('/enquire');
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Naledi' } });
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'A 2-bed in August' } });
    fireEvent.click(screen.getByRole('button', { name: /Send enquiry/ }));

    await waitFor(() => expect(submitEnquiry).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Naledi', message: 'A 2-bed in August', source: 'WEBSITE',
    })));
    expect(await screen.findByText(/ENQ-ABC123/)).toBeInTheDocument();
  });

  it('tags the source as WHATSAPP from ?src=whatsapp', async () => {
    renderAt('/enquire?src=whatsapp');
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Kagiso' } });
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Weekend stay' } });
    fireEvent.click(screen.getByRole('button', { name: /Send enquiry/ }));

    await waitFor(() => expect(submitEnquiry).toHaveBeenCalledWith(expect.objectContaining({ source: 'WHATSAPP' })));
  });

  it('keeps Send enquiry disabled when optional email is malformed', () => {
    renderAt('/enquire');
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Naledi' } });
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'A 2-bed in August' } });
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'not-an-email' } });

    expect(screen.getByRole('button', { name: /Send enquiry/ })).toBeDisabled();
    expect(submitEnquiry).not.toHaveBeenCalled();
  });

  it('allows submit when optional email is empty or well-formed', async () => {
    renderAt('/enquire');
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Naledi' } });
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'A 2-bed in August' } });
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'naledi@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Send enquiry/ }));

    await waitFor(() => expect(submitEnquiry).toHaveBeenCalled());
  });

  // (R5) With more than one property, the guest says which one the enquiry is for.
  it('sends the chosen property when there is more than one', async () => {
    getEnquiryProperties.mockResolvedValue([
      { id: 'p-cbd', name: 'CBD' },
      { id: 'p-vil', name: 'Village' },
    ]);
    renderAt('/enquire');
    const select = await screen.findByLabelText('Which property?');
    fireEvent.change(select, { target: { value: 'p-vil' } });
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Naledi' } });
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'A 2-bed' } });
    fireEvent.click(screen.getByRole('button', { name: /Send enquiry/ }));

    await waitFor(() => expect(submitEnquiry).toHaveBeenCalledWith(expect.objectContaining({ property_id: 'p-vil' })));
  });

  it('hides the property box when there is only one property', async () => {
    getEnquiryProperties.mockResolvedValue([{ id: 'p-only', name: 'Village' }]);
    renderAt('/enquire');
    await waitFor(() => expect(getEnquiryProperties).toHaveBeenCalled());
    expect(screen.queryByLabelText('Which property?')).not.toBeInTheDocument();
  });
});
