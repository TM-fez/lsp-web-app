import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { submitEnquiry } = vi.hoisted(() => ({ submitEnquiry: vi.fn() }));
vi.mock('@/lib/api/public', () => ({ submitEnquiry }));

import { EnquirePage } from './EnquirePage';

const renderAt = (path: string) =>
  render(<MemoryRouter initialEntries={[path]}><EnquirePage /></MemoryRouter>);

describe('EnquirePage', () => {
  beforeEach(() => submitEnquiry.mockReset().mockResolvedValue({ reference: 'ENQ-ABC123' }));

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
});
