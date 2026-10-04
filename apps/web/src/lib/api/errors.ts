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
