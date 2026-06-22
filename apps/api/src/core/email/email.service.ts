import { env } from '../../config/env.js';
import { AppError } from '../errors/AppError.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

/** True once an API key and a verified sender are configured. */
export function isEmailConfigured(): boolean {
  return Boolean(env.BREVO_API_KEY && env.EMAIL_FROM);
}

// Sends via Brevo's transactional HTTP API (no SMTP, no extra dependency — uses
// Node's built-in fetch). Swapping providers means changing only this file; callers
// just use sendEmail().
export async function sendEmail(msg: EmailMessage): Promise<{ messageId: string }> {
  if (!isEmailConfigured()) {
    throw AppError.badRequest(
      'Email is not configured. Set BREVO_API_KEY and EMAIL_FROM (a verified Brevo sender).',
    );
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY as string,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: env.EMAIL_FROM_NAME, email: env.EMAIL_FROM },
      to: [{ email: msg.to }],
      subject: msg.subject,
      htmlContent: msg.html,
      ...(msg.replyTo ? { replyTo: { email: msg.replyTo } } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw AppError.badRequest(`Email provider rejected the send (HTTP ${res.status}). ${detail.slice(0, 200)}`);
  }

  const data = (await res.json().catch(() => ({}))) as { messageId?: string };
  return { messageId: data.messageId ?? 'sent' };
}
