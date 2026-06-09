import { describe, it, expect } from 'vitest';
import { USER_LEAD_STATUSES, LEAD_SOURCES, statusTone, statusLabel, sourceLabel, sourceText } from './util';

describe('lead status helpers', () => {
  it('user-settable statuses exclude CONVERTED', () => {
    expect(USER_LEAD_STATUSES).not.toContain('CONVERTED');
    expect(USER_LEAD_STATUSES).toEqual(['NEW', 'CONTACTED', 'QUALIFIED', 'LOST']);
  });

  it('has a tone for every status (incl. CONVERTED for display)', () => {
    (['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'] as const).forEach((s) =>
      expect(statusTone[s]).toBeTruthy(),
    );
  });

  it('labels are title-case', () => {
    expect(statusLabel('NEW')).toBe('New');
    expect(statusLabel('CONTACTED')).toBe('Contacted');
    expect(statusLabel('CONVERTED')).toBe('Converted');
  });
});

describe('lead source helpers', () => {
  it('every source has a human label', () => {
    LEAD_SOURCES.forEach((s) => expect(sourceLabel[s]).toBeTruthy());
  });

  it('maps key channels nicely', () => {
    expect(sourceLabel.WHATSAPP).toBe('WhatsApp');
    expect(sourceLabel.WALK_IN).toBe('Walk-in');
    expect(sourceLabel.BOOKING_COM).toBe('Booking.com');
  });

  it('sourceText handles null', () => {
    expect(sourceText(null)).toBe('—');
    expect(sourceText('REFERRAL')).toBe('Referral');
  });
});
