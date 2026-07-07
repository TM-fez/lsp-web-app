import { api } from './client';

export interface StayUnitOption {
  unit_type: string;
  name: string;
  nightly_rate: number; // thebe
  deposit_pct: number;
  max_guests: number;
  min_nights: number;
  currency: string;
}

export interface BookingInput {
  unit_type: string;
  check_in: string; // YYYY-MM-DD
  check_out: string;
  guests: number;
  name: string;
  email: string;
  phone: string;
}

export interface BookingConfirmation {
  confirmation_code: string;
  reservation_id: string;
  guest_name: string;
  unit_code: string;
  unit_name: string;
  unit_type: string;
  check_in: string;
  check_out: string;
  guests: number;
  pricing:
    | {
        priceable: true;
        currency: string;
        nights: number;
        subtotal: number;
        tax_amount: number;
        total_amount: number;
        deposit_amount: number;
        deposit_pct: number;
      }
    | { priceable: false; reason: string; nights: number };
}

export async function getStayInfo(): Promise<{ units: StayUnitOption[] }> {
  const { data } = await api.get<{ units: StayUnitOption[] }>('/public/stay');
  return data;
}

export async function createBooking(input: BookingInput): Promise<BookingConfirmation> {
  const { data } = await api.post<BookingConfirmation>('/public/bookings', input);
  return data;
}

export interface PublicBookingSummary {
  confirmation_code: string;
  guest_name: string;
  status: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
  unit_name: string;
  unit_type: string;
  check_in: string;
  check_out: string;
}

/** Manage-my-booking: both the code and the booking email must match. */
export async function lookupBooking(code: string, email: string): Promise<PublicBookingSummary> {
  const { data } = await api.get<PublicBookingSummary>('/public/bookings/lookup', {
    params: { code, email },
  });
  return data;
}

// ── In-apartment QR self check-in (Phase 5) ──────────────────────────────────
export interface GuestCheckinInfo {
  property_name: string;
  unit_name: string;
  unit_code: string;
  has_stay: boolean;
  check_out_date: string | null; // YYYY-MM-DD
  already_checked_in: boolean;
}
export interface SelfCheckinInput {
  token: string;
  name: string;
  email: string;
  phone?: string;
}

/** The unit context behind a QR token (no other guest's details). */
export async function getCheckinInfo(token: string): Promise<GuestCheckinInfo> {
  const { data } = await api.get<GuestCheckinInfo>('/public/checkin', { params: { token } });
  return data;
}

/** The guest confirms their own details from the apartment. */
export async function submitCheckin(input: SelfCheckinInput): Promise<{ property_name: string; unit_name: string }> {
  const { data } = await api.post<{ property_name: string; unit_name: string }>('/public/checkin', input);
  return data;
}

// ── Public enquiry capture (Phase 5 CRM) ─────────────────────────────────────
export type EnquirySource = 'WEBSITE' | 'WHATSAPP' | 'REFERRAL' | 'OTHER';
export interface EnquiryInput {
  name: string;
  email?: string;
  phone?: string;
  message: string;
  source?: EnquirySource;
}

/** File a public enquiry — becomes a NEW lead (and a CRM contact when emailed). */
export async function submitEnquiry(input: EnquiryInput): Promise<{ reference: string }> {
  const { data } = await api.post<{ reference: string }>('/public/enquiries', input);
  return data;
}
