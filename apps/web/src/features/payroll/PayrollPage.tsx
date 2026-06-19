import { useState } from 'react';
import { Users, Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/auth';
import { formatMoney, pulaToThebe, thebeToPula } from '@/lib/utils/money';
import { cn } from '@/lib/utils/cn';
import { useEmployees, usePayrollSummary, useUpsertCompensation, usePostPayroll } from './hooks';
import type { EmployeePay, PayFrequency } from '@/types';

const PAYMENT_METHODS = ['Bank transfer', 'Cash', 'Mobile money'];
const monthName = new Date().toLocaleString('en', { month: 'long' });

interface FormState {
  gross: string; frequency: PayFrequency; job_title: string;
  payment_method: string; bank_name: string; bank_account: string;
  start_date: string; active: boolean; notes: string;
}
const formFor = (e: EmployeePay): FormState => ({
  gross: e.gross_amount !== null ? thebeToPula(e.gross_amount) : '',
  frequency: e.frequency ?? 'MONTHLY',
  job_title: e.job_title ?? '',
  payment_method: e.payment_method ?? '',
  bank_name: e.bank_name ?? '',
  bank_account: e.bank_account ?? '',
  start_date: e.start_date ?? '',
  active: e.active,
  notes: e.notes ?? '',
});

export function PayrollPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canManage = hasPerm('payroll.manage');

  const employees = useEmployees();
  const summary = usePayrollSummary();
  const upsert = useUpsertCompensation();
  const post = usePostPayroll();

  const [editing, setEditing] = useState<EmployeePay | null>(null);
  const [form, setForm] = useState<FormState>({ gross: '', frequency: 'MONTHLY', job_title: '', payment_method: '', bank_name: '', bank_account: '', start_date: '', active: true, notes: '' });

  const open = (e: EmployeePay) => { setForm(formFor(e)); setEditing(e); };

  const thebe = pulaToThebe(form.gross);
  const valid = !Number.isNaN(thebe) && thebe >= 0;

  const save = () => {
    if (!editing || !valid) return;
    upsert.mutate({
      userId: editing.user_id,
      input: {
        gross_amount: thebe,
        frequency: form.frequency,
        job_title: form.job_title.trim() || null,
        payment_method: form.payment_method || null,
        bank_name: form.bank_name.trim() || null,
        bank_account: form.bank_account.trim() || null,
        start_date: form.start_date || null,
        active: form.active,
        notes: form.notes.trim() || null,
      },
    }, { onSuccess: () => setEditing(null) });
  };

  const rows = employees.data ?? [];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex animate-rise flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-muted">
            <span className="h-px w-10 bg-ink" /> Finance · Gaborone
          </div>
          <h1 className="font-display text-4xl text-ink sm:text-5xl">Payroll</h1>
          <p className="mt-2 text-sm text-muted">Who gets paid what — salaries by employee, posted monthly to costs.</p>
        </div>
        {canManage && rows.length > 0 && (
          <Button variant="primary" disabled={post.isPending || (summary.data?.monthly_total ?? 0) === 0}
            onClick={() => post.mutate(undefined)}>
            <Banknote className="mr-1.5 h-4 w-4" />Post {monthName} to costs
          </Button>
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-paper p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Monthly payroll</div>
          <div className="mt-2 font-display text-3xl tabnum text-ink">{summary.data ? formatMoney(summary.data.monthly_total) : '—'}</div>
        </div>
        <div className="rounded-lg border border-line bg-paper p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">People on payroll</div>
          <div className="mt-2 font-display text-3xl tabnum text-ink">{summary.data?.headcount ?? '—'}</div>
        </div>
        <div className="rounded-lg border border-line bg-paper p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Annualised</div>
          <div className="mt-2 font-display text-3xl tabnum text-ink">{summary.data ? formatMoney(summary.data.monthly_total * 12) : '—'}</div>
        </div>
      </div>

      {employees.isLoading ? (
        <div className="flex h-40 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : employees.isError ? (
        <EmptyState title="Couldn’t load payroll" description="The server didn’t respond. Try again."
          action={<Button variant="outline" onClick={() => employees.refetch()}>Retry</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Users className="h-8 w-8" />} title="No staff yet"
          description="Add staff in Admin → Users & Roles, then set their pay here." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-paper">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                <th className="px-4 py-3.5 font-medium">Employee</th>
                <th className="px-4 py-3.5 font-medium">Pay</th>
                <th className="px-4 py-3.5 text-right font-medium">Monthly</th>
                <th className="px-4 py-3.5 font-medium">Payment</th>
                <th className="px-4 py-3.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.user_id} className={cn('border-b border-line last:border-0 hover:bg-cream-2', !e.active && e.gross_amount !== null && 'opacity-60')}>
                  <td className="px-4 py-3.5">
                    <div className="font-display text-lg text-ink">{e.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted">
                      <Badge tone="slate">{e.role}</Badge>{e.is_lead && <span>lead</span>}
                      {e.job_title && <span className="normal-case tracking-normal">· {e.job_title}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-ink">
                    {e.gross_amount !== null
                      ? <span className="tabnum">{formatMoney(e.gross_amount)} <span className="text-xs text-muted">/ {e.frequency === 'WEEKLY' ? 'week' : 'month'}</span></span>
                      : <span className="text-muted">Not set</span>}
                  </td>
                  <td className="px-4 py-3.5 text-right tabnum text-ink">{e.monthly_equivalent !== null ? formatMoney(e.monthly_equivalent) : '—'}</td>
                  <td className="px-4 py-3.5 text-muted">{e.payment_method ?? '—'}</td>
                  <td className="px-4 py-3.5 text-right">
                    {canManage && (
                      <Button size="sm" variant="outline" onClick={() => open(e)}>
                        {e.gross_amount !== null ? 'Edit pay' : 'Set pay'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.name}</DialogTitle>
            <DialogDescription>Set this employee’s pay. Amounts in Pula; salaries are visible only to Payroll roles.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-amt">Gross pay (Pula)</Label>
              <Input id="pay-amt" inputMode="decimal" value={form.gross} onChange={(e) => setForm({ ...form, gross: e.target.value })} placeholder="0.00" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-freq">Frequency</Label>
              <Select id="pay-freq" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as PayFrequency })}>
                <option value="MONTHLY">Monthly</option>
                <option value="WEEKLY">Weekly</option>
              </Select>
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="pay-title">Job title</Label>
              <Input id="pay-title" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="e.g. Head Housekeeper" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-method">Payment method</Label>
              <Select id="pay-method" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                <option value="">—</option>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-start">Start date</Label>
              <Input id="pay-start" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-bank">Bank</Label>
              <Input id="pay-bank" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} placeholder="e.g. FNB" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-acct">Account no.</Label>
              <Input id="pay-acct" value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm text-char">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              On payroll (counts toward the monthly total)
            </label>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" disabled={!valid || upsert.isPending} onClick={save}>Save pay</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
