import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CallButton } from './CallButton';

// A one-tap "Call" beside WhatsApp, for the desk phone or a staff member's own phone.
// Botswana numbers typed locally ("71 234 567", "071234567") dial as +267.
describe('CallButton', () => {
  it('dials a local number in international form', () => {
    render(<CallButton phone="71 234 567" />);
    expect(screen.getByRole('link', { name: /Call/ })).toHaveAttribute('href', 'tel:+26771234567');
  });

  it('keeps an international number as typed', () => {
    render(<CallButton phone="+44 20 7946 0958" />);
    expect(screen.getByRole('link', { name: /Call/ })).toHaveAttribute('href', 'tel:+442079460958');
  });

  it('renders nothing without a usable number', () => {
    const { container } = render(<CallButton phone="  " />);
    expect(container).toBeEmptyDOMElement();
  });
});
