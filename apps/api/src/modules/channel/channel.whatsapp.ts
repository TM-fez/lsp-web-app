import { env } from '../../config/env.js';

export interface WhatsAppResult {
  status: 'sent' | 'skipped' | 'failed';
  detail?: string;
}

/** True once a provider token, sender, and recipient are all configured. */
export function isWhatsAppConfigured(): boolean {
  return Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_FROM && env.WHATSAPP_TO);
}

/**
 * WhatsApp alert SEAM — built, wired into the dispatcher, but intentionally DARK.
 *
 * WhatsApp Business requires a pre-approved message template and number verification that
 * takes days. Until that clears we must never call the provider, so this returns 'skipped'
 * even when creds are present — the kill-switch is WHATSAPP_LIVE, which represents template
 * approval, NOT deployment. Email + dashboard are the day-one channels.
 *
 * To go live (once a template id is approved): implement the provider POST where marked
 * and set WHATSAPP_LIVE=1. Nothing else in the alert path changes.
 */
export async function sendWhatsAppMessage(text: string): Promise<WhatsAppResult> {
  if (!isWhatsAppConfigured()) return { status: 'skipped', detail: 'WhatsApp not configured' };
  if (!env.WHATSAPP_LIVE) {
    return { status: 'skipped', detail: 'dark until template approval (WHATSAPP_LIVE!=1)' };
  }

  // TODO(provider): POST `text` to the Twilio / Meta Cloud API here using WHATSAPP_TOKEN,
  // WHATSAPP_FROM → WHATSAPP_TO with the approved template. Until that exists, stay dark.
  void text;
  return { status: 'skipped', detail: 'provider call not wired yet' };
}
