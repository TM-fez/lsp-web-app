import { api } from './client';

/** (P7) Business details printed on invoices, and the two business rules the owner may tune. */
export interface AppSettings {
  company_name: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  vat_number: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_branch_code: string | null;
  invoice_footer: string | null;
  invoice_terms_days: number | null;
  website_hold_hours: number | null;
  updated_at: string;
  /** What applies while a field is left empty. */
  defaults: { company_name: string; invoice_terms_days: number; website_hold_hours: number };
}

export type UpdateSettingsInput = Partial<
  Omit<AppSettings, 'updated_at' | 'defaults'>
>;

export interface ChangePasswordInput {
  current_password: string;
  new_password: string;
}

export async function getSettings(): Promise<AppSettings> {
  const { data } = await api.get<AppSettings>('/settings');
  return data;
}

export async function updateSettings(input: UpdateSettingsInput): Promise<AppSettings> {
  const { data } = await api.patch<AppSettings>('/settings', input);
  return data;
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
  await api.post('/auth/change-password', input);
}
