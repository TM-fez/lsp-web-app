import type { Kysely } from 'kysely';
import type { AppSettingsRow, Database } from '../../db/types.js';
import { env } from '../../config/env.js';

/**
 * (P7) The business's own settings (migration 074): one row, every field optional.
 *
 * Read fresh where it matters — one indexed single-row select — rather than cached, so an
 * owner who changes payment terms sees the very next invoice use them, and a multi-step
 * transaction can read it with its own connection (`db` may be a Transaction).
 */
export async function getAppSettings(db: Kysely<Database>): Promise<AppSettingsRow | undefined> {
  return db.selectFrom('app_settings').selectAll().where('id', '=', 1).executeTakeFirst();
}

/** Built-in name used until the owner sets one — what invoices have always said. */
export const DEFAULT_COMPANY_NAME = 'Lifestyle Apartments';

/** Days after issue/check-in an invoice falls due: the owner's setting, else the env default. */
export async function invoiceTermsDays(db: Kysely<Database>): Promise<number> {
  return (await getAppSettings(db))?.invoice_terms_days ?? env.INVOICE_TERMS_DAYS;
}

/** Hours an unpaid website booking holds its room before the sweep cancels it. */
export async function websiteHoldHours(db: Kysely<Database>): Promise<number> {
  return (await getAppSettings(db))?.website_hold_hours ?? env.WEBSITE_PENDING_TTL_HOURS;
}

/** What a printed or emailed invoice shows about the business. */
export interface CompanyDetails {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  vat_number: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_branch_code: string | null;
  footer: string | null;
}

export async function companyDetails(db: Kysely<Database>): Promise<CompanyDetails> {
  const s = await getAppSettings(db);
  return {
    name: s?.company_name || DEFAULT_COMPANY_NAME,
    address: s?.company_address ?? null,
    phone: s?.company_phone ?? null,
    email: s?.company_email ?? null,
    vat_number: s?.vat_number ?? null,
    bank_name: s?.bank_name ?? null,
    bank_account_name: s?.bank_account_name ?? null,
    bank_account_number: s?.bank_account_number ?? null,
    bank_branch_code: s?.bank_branch_code ?? null,
    footer: s?.invoice_footer ?? null,
  };
}
