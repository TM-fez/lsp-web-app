/** Pull a human message out of an Axios error (API sends { message } or { error }). */
export function errMessage(e: unknown): string {
  const a = e as { response?: { data?: { message?: string; error?: string } } };
  return a?.response?.data?.message || a?.response?.data?.error || 'Something went wrong';
}
