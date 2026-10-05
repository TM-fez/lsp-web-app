/** Pull a human message out of an Axios error (API sends { message } or { error }). */
export function errMessage(e: unknown): string {
  const a = e as { response?: { data?: { message?: string; error?: string } } };
  return a?.response?.data?.message || a?.response?.data?.error || 'Something went wrong';
}

/** (R5) The server's "another guest already uses this email" question — answered with "Save anyway". */
export function isDuplicateEmail(e: unknown): boolean {
  const a = e as { response?: { status?: number; data?: { error?: string } } };
  return a?.response?.status === 409 && a?.response?.data?.error === 'Duplicate Email';
}

/** (R7 N7-4) The server's question "this unit still has bookings or holds ahead" — answered with "anyway". */
export function unitHasBookingsMessage(e: unknown): string | null {
  const a = e as { response?: { status?: number; data?: { error?: string; message?: string } } };
  return a?.response?.status === 409 && a?.response?.data?.error === 'Unit Has Bookings'
    ? a.response.data.message ?? 'This unit still has bookings or holds ahead.'
    : null;
}

/** (R6) The server's question "this repair falls on booked / held nights" — answered with "Save anyway". */
export function repairOverlapMessage(e: unknown): string | null {
  const a = e as { response?: { status?: number; data?: { error?: string; message?: string } } };
  return a?.response?.status === 409 && a?.response?.data?.error === 'Repair Overlap'
    ? a.response.data.message ?? 'This repair falls on booked or held nights.'
    : null;
}
