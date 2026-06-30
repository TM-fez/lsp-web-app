/**
 * wa.me deep links — so staff can open WhatsApp pre-loaded with a contact's chat
 * (and an optional message) straight from their own phone. This is deliberately
 * NOT the WhatsApp Business API: the staff member sends the message themselves,
 * which is what the client asked for.
 *
 * Numbers are normalised to international digits (no "+", no spaces) because
 * that's the format wa.me expects. Botswana (+267) is assumed when a number has
 * no country code, since that's where the business operates.
 */
const DEFAULT_COUNTRY_CODE = '267'; // Botswana

/**
 * Turn a free-typed phone number into wa.me-ready international digits, or null
 * when there's nothing usable. Handles "+267 71 …", "267…", "0…" and bare local
 * numbers.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, ''); // keep digits only
  if (!digits) return null;

  if (hasPlus || digits.startsWith('00')) {
    // Already international — drop a leading "00" international prefix if present.
    digits = digits.replace(/^00/, '');
  } else if (!digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    // Bare local number — drop a leading trunk 0, then prepend the country code.
    digits = DEFAULT_COUNTRY_CODE + digits.replace(/^0+/, '');
  }

  // A usable international number is ~8–15 digits (E.164 caps at 15).
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/**
 * Build a wa.me link for a phone number, optionally with a prefilled message.
 * Returns null when the number isn't usable, so callers can render conditionally.
 */
export function whatsappLink(
  phone: string | null | undefined,
  message?: string,
): string | null {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
