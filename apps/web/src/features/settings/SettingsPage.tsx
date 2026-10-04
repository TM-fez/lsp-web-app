import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { KeyRound, Building, Scale, Save, Settings as SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/store/auth';
import type { AppSettings } from '@/lib/api/settings';
import { useSettings, useUpdateSettings, useChangePassword } from './hooks';

/**
 * (P7) Settings — three things, each for a different person.
 *
 * - My account: everyone can change their own password. Doing so signs out their other
 *   devices (a stolen session dies with the old password) but keeps this one.
 * - Business details: what invoices print — name, address, VAT number, bank details for
 *   paying by transfer, a footer line. Empty fields fall back to built-in defaults.
 * - Business rules: payment terms (owner decision 2026-10-02: 7 days) and how long a
 *   website booking holds a unit unpaid. Only new invoices / new holds pick a change up.
 *
 * The last two need settings.update (admin); without it they are not shown at all.
 */
export function SettingsPage() {
  const canEdit = useAuthStore((s) => s.hasPerm('settings.update'));
  const canRead = useAuthStore((s) => s.hasPerm('settings.read'));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-4xl text-ink">Settings</h1>
        <p className="text-sm text-slate-500">
          {canEdit
            ? 'Your password, the business details printed on invoices, and the house rules.'
            : 'Change your password.'}
        </p>
      </div>

      <PasswordCard />
      {canRead && <BusinessSettings canEdit={canEdit} />}
    </div>
  );
}

const PASSWORD_RULES = 'At least 8 characters, with an uppercase letter, a lowercase letter, a number and a symbol.';
const meetsRules = (p: string) =>
  p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);

function PasswordCard() {
  const change = useChangePassword();
  const email = useAuthStore((s) => s.user?.email ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const mismatch = confirm.length > 0 && next !== confirm;
  const valid = current.length > 0 && meetsRules(next) && next === confirm && next !== current;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    try {
      await change.mutateAsync({ current_password: current, new_password: next });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch {
      /* hook surfaces the error toast */
    }
  };

  return (
    <Section icon={<KeyRound className="h-4 w-4" />} title="My account" hint="Change the password you sign in with. Your other devices will be signed out.">
      <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
        {/* Browsers and password managers expect a username beside a password-change
            form (the console warned about it — re-test 3); hidden, read-only. */}
        <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
        <Field id="pw-current" label="Current password">
          <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field id="pw-new" label="New password" hint={PASSWORD_RULES}>
          <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field id="pw-confirm" label="Type the new password again" error={mismatch ? 'The two new passwords don’t match.' : undefined}>
          <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <div>
          <Button type="submit" disabled={!valid || change.isPending}>
            <KeyRound className="h-4 w-4" /> {change.isPending ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Section>
  );
}

interface BusinessProps {
  canEdit: boolean;
}

function BusinessSettings({ canEdit }: BusinessProps) {
  const { data, isLoading, isError, refetch } = useSettings();

  if (isLoading) return <Spinner />;
  if (isError || !data) {
    return (
      <EmptyState
        icon={<SettingsIcon className="h-6 w-6" />}
        title="Couldn’t load the business settings"
        description="The server didn’t answer. Check your connection and try again."
        action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
      />
    );
  }
  return (
    <>
      <DetailsCard settings={data} canEdit={canEdit} />
      <RulesCard settings={data} canEdit={canEdit} />
    </>
  );
}

const DETAIL_FIELDS = [
  { key: 'company_name', label: 'Business name', placeholder: '' },
  { key: 'company_address', label: 'Address', placeholder: 'Plot 123, Village, Gaborone' },
  { key: 'company_phone', label: 'Phone', placeholder: '+267 …' },
  { key: 'company_email', label: 'Email', placeholder: 'bookings@…' },
  { key: 'vat_number', label: 'VAT number', placeholder: 'Leave empty if not VAT-registered' },
  { key: 'bank_name', label: 'Bank', placeholder: 'e.g. First National Bank Botswana' },
  { key: 'bank_account_name', label: 'Account name', placeholder: '' },
  { key: 'bank_account_number', label: 'Account number', placeholder: '' },
  { key: 'bank_branch_code', label: 'Branch code', placeholder: '' },
] as const;
type DetailKey = (typeof DETAIL_FIELDS)[number]['key'] | 'invoice_footer';

interface CardProps {
  settings: AppSettings;
  canEdit: boolean;
}

function DetailsCard({ settings, canEdit }: CardProps) {
  const update = useUpdateSettings();
  const initial = () =>
    Object.fromEntries(
      [...DETAIL_FIELDS.map((f) => f.key), 'invoice_footer' as const].map((k) => [k, settings[k] ?? ''])
    ) as Record<DetailKey, string>;
  const [form, setForm] = useState<Record<DetailKey, string>>(initial);

  // Re-seed when the server copy changes (after a save, or another admin's edit).
  useEffect(() => setForm(initial()), [settings.updated_at]);

  const set = (k: DetailKey, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const emailOk = !form.company_email.trim() || /^\S+@\S+\.\S+$/.test(form.company_email.trim());
  const valid = emailOk;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    try {
      await update.mutateAsync(form);
    } catch {
      /* hook surfaces the error toast */
    }
  };

  return (
    <Section
      icon={<Building className="h-4 w-4" />}
      title="Business details"
      hint="Printed on every invoice and invoice email. Bank details show on unpaid invoices so guests can pay by transfer."
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
          {DETAIL_FIELDS.map((f) => (
            <Field
              key={f.key}
              id={`set-${f.key}`}
              label={f.label}
              error={f.key === 'company_email' && !emailOk ? 'Enter a valid email address.' : undefined}
            >
              <Input
                id={`set-${f.key}`}
                value={form[f.key]}
                placeholder={f.key === 'company_name' ? settings.defaults.company_name : f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </Field>
          ))}
          <div className="sm:col-span-2">
            <Field id="set-invoice_footer" label="Invoice footer (optional)" hint="A short line at the bottom of every invoice — e.g. a thank-you or your registration number.">
              <textarea
                id="set-invoice_footer"
                rows={2}
                value={form.invoice_footer}
                onChange={(e) => set('invoice_footer', e.target.value)}
                className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              />
            </Field>
          </div>
        </fieldset>
        {canEdit && (
          <div>
            <Button type="submit" disabled={!valid || update.isPending}>
              <Save className="h-4 w-4" /> {update.isPending ? 'Saving…' : 'Save business details'}
            </Button>
          </div>
        )}
      </form>
    </Section>
  );
}

function RulesCard({ settings, canEdit }: CardProps) {
  const update = useUpdateSettings();
  const seed = () => ({
    terms: settings.invoice_terms_days?.toString() ?? '',
    hold: settings.website_hold_hours?.toString() ?? '',
  });
  const [form, setForm] = useState(seed);
  useEffect(() => setForm(seed()), [settings.updated_at]);

  const inRange = (v: string, min: number, max: number) =>
    v.trim() === '' || (/^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max);
  const termsOk = inRange(form.terms, 0, 90);
  const holdOk = inRange(form.hold, 1, 168);
  const valid = termsOk && holdOk;
  // Empty means "use the default", which the server stores as NULL.
  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    try {
      await update.mutateAsync({ invoice_terms_days: num(form.terms), website_hold_hours: num(form.hold) });
    } catch {
      /* hook surfaces the error toast */
    }
  };

  const { defaults } = settings;
  return (
    <Section
      icon={<Scale className="h-4 w-4" />}
      title="Business rules"
      hint="Changes apply from now on — existing invoices and bookings keep what they were given."
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
          <Field
            id="set-terms"
            label="Payment terms (days)"
            hint={`How long a guest has to pay an invoice, counted from check-in (or the invoice date, if later). Leave empty for the default (${defaults.invoice_terms_days} days).`}
            error={termsOk ? undefined : 'Enter a whole number of days from 0 to 90.'}
          >
            <Input id="set-terms" inputMode="numeric" placeholder={String(defaults.invoice_terms_days)} value={form.terms} onChange={(e) => setForm((f) => ({ ...f, terms: e.target.value }))} />
          </Field>
          <Field
            id="set-hold"
            label="Website booking hold (hours)"
            hint={`How long an unpaid booking from the website keeps the unit before it’s released. Leave empty for the default (${defaults.website_hold_hours} hours).`}
            error={holdOk ? undefined : 'Enter a whole number of hours from 1 to 168 (7 days).'}
          >
            <Input id="set-hold" inputMode="numeric" placeholder={String(defaults.website_hold_hours)} value={form.hold} onChange={(e) => setForm((f) => ({ ...f, hold: e.target.value }))} />
          </Field>
        </fieldset>
        {canEdit && (
          <div>
            <Button type="submit" disabled={!valid || update.isPending}>
              <Save className="h-4 w-4" /> {update.isPending ? 'Saving…' : 'Save business rules'}
            </Button>
          </div>
        )}
      </form>
    </Section>
  );
}

interface SectionProps {
  icon: ReactNode;
  title: string;
  hint: string;
  children: ReactNode;
}

function Section({ icon, title, hint, children }: SectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon} {title}
        </CardTitle>
        <p className="text-xs text-slate-500">{hint}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-rose-600">{error}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
