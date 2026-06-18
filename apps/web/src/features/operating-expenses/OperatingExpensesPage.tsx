import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banknote, Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/auth';
import { listProperties } from '@/lib/api/properties';
import { formatMoney, pulaToThebe, thebeToPula } from '@/lib/utils/money';
import { todayISO } from '@/lib/utils/date';
import { cn } from '@/lib/utils/cn';
import { useOperatingExpenses, useCreateOperatingExpense, useUpdateOperatingExpense, useDeleteOperatingExpense } from './hooks';
import type { OperatingExpense, OperatingExpenseCategory } from '@/types';

const CATEGORIES: OperatingExpenseCategory[] = ['RENT', 'PAYROLL', 'UTILITIES', 'MARKETING', 'INSURANCE', 'SUPPLIES', 'SOFTWARE', 'OTHER'];
const catLabel = (c: OperatingExpenseCategory) => c.charAt(0) + c.slice(1).toLowerCase();
const catTone: Record<OperatingExpenseCategory, 'slate' | 'green' | 'amber' | 'blue'> = {
  RENT: 'blue', PAYROLL: 'green', UTILITIES: 'amber', MARKETING: 'blue',
  INSURANCE: 'slate', SUPPLIES: 'slate', SOFTWARE: 'slate', OTHER: 'slate',
};

interface FormState {
  category: OperatingExpenseCategory;
  description: string;
  vendor: string;
  amount: string;          // Pula
  incurred_on: string;     // YYYY-MM-DD
  property_id: string;     // '' = company-wide
}
const emptyForm = (): FormState => ({
  category: 'RENT', description: '', vendor: '', amount: '', incurred_on: todayISO(), property_id: '',
});

export function OperatingExpensesPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canCreate = hasPerm('opex.create');
  const canUpdate = hasPerm('opex.update');
  const canDelete = hasPerm('opex.delete');

  const [category, setCategory] = useState<OperatingExpenseCategory | 'ALL'>('ALL');
  const { data, isLoading, isError, refetch } = useOperatingExpenses(category === 'ALL' ? {} : { category });
  const properties = useQuery({ queryKey: ['properties'], queryFn: listProperties });

  const create = useCreateOperatingExpense();
  const update = useUpdateOperatingExpense();
  const remove = useDeleteOperatingExpense();
  const busy = create.isPending || update.isPending || remove.isPending;

  // Dialog state — null = closed, 'new' = create, OperatingExpense = edit.
  const [editing, setEditing] = useState<OperatingExpense | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const openNew = () => { setForm(emptyForm()); setEditing('new'); };
  const openEdit = (e: OperatingExpense) => {
    setForm({
      category: e.category, description: e.description, vendor: e.vendor ?? '',
      amount: thebeToPula(e.amount), incurred_on: e.incurred_on.slice(0, 10),
      property_id: e.property_id ?? '',
    });
    setEditing(e);
  };

  const thebe = pulaToThebe(form.amount);
  const valid = form.description.trim().length > 0 && !Number.isNaN(thebe) && thebe > 0 && /^\d{4}-\d{2}-\d{2}$/.test(form.incurred_on);

  const submit = () => {
    if (!valid) return;
    const payload = {
      category: form.category,
      description: form.description.trim(),
      vendor: form.vendor.trim() || null,
      amount: thebe,
      incurred_on: form.incurred_on,
      property_id: form.property_id || null,
    };
    const done = { onSuccess: () => setEditing(null) };
    if (editing === 'new') create.mutate(payload, done);
    else if (editing) update.mutate({ id: editing.id, input: payload }, done);
  };

  const rows = data ?? [];
  const total = rows.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex animate-rise flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-muted">
            <span className="h-px w-10 bg-ink" /> Finance · Gaborone
          </div>
          <h1 className="font-display text-4xl text-ink sm:text-5xl">Operating costs</h1>
          <p className="mt-2 text-sm text-muted">Rent, payroll, utilities and other overheads behind the P&amp;L.</p>
        </div>
        <div className="flex items-end gap-4">
          {rows.length > 0 && (
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Shown</div>
              <div className="font-display text-3xl tabnum text-ink">{formatMoney(total)}</div>
            </div>
          )}
          {canCreate && (
            <Button variant="primary" onClick={openNew}><Plus className="mr-1.5 h-4 w-4" />Add cost</Button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {(['ALL', ...CATEGORIES] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-xs transition-[background-color,color,border-color] duration-300',
              category === c ? 'border-forest bg-forest text-cream' : 'border-line bg-paper text-char hover:border-ink',
            )}
          >
            {c === 'ALL' ? 'All' : catLabel(c)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : isError ? (
        <EmptyState title="Couldn’t load costs" description="The server didn’t respond. Try again."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Banknote className="h-8 w-8" />} title="No operating costs"
          description="Add rent, payroll, utilities and other overheads so the P&L reflects true margin."
          action={canCreate ? <Button variant="primary" onClick={openNew}>Add the first cost</Button> : undefined} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-paper">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                <th className="px-4 py-3.5 font-medium">Date</th>
                <th className="px-4 py-3.5 font-medium">Category</th>
                <th className="px-4 py-3.5 font-medium">Description</th>
                <th className="px-4 py-3.5 font-medium">Property</th>
                <th className="px-4 py-3.5 text-right font-medium">Amount</th>
                <th className="px-4 py-3.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-line transition-colors duration-300 last:border-0 hover:bg-cream-2">
                  <td className="px-4 py-3.5 tabnum text-muted">{e.incurred_on.slice(0, 10)}</td>
                  <td className="px-4 py-3.5"><Badge tone={catTone[e.category]}>{catLabel(e.category)}</Badge></td>
                  <td className="px-4 py-3.5 text-ink">
                    {e.description}
                    {e.vendor && <span className="block text-xs text-muted">{e.vendor}</span>}
                  </td>
                  <td className="px-4 py-3.5 text-muted">{e.property_name ?? 'Company-wide'}</td>
                  <td className="px-4 py-3.5 text-right tabnum text-ink">{formatMoney(e.amount, e.currency)}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex justify-end gap-1.5">
                      {canUpdate && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => openEdit(e)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                      )}
                      {canDelete && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (confirm('Remove this cost?')) remove.mutate(e.id); }} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                      )}
                    </div>
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
            <DialogTitle>{editing === 'new' ? 'Add operating cost' : 'Edit operating cost'}</DialogTitle>
            <DialogDescription>Recorded against the period’s P&amp;L. Enter the amount in Pula.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oe-cat">Category</Label>
              <Select id="oe-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as OperatingExpenseCategory })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oe-date">Date</Label>
              <Input id="oe-date" type="date" value={form.incurred_on} onChange={(e) => setForm({ ...form, incurred_on: e.target.value })} />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="oe-desc">Description</Label>
              <Input id="oe-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Monthly rent — Village" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oe-amount">Amount (Pula)</Label>
              <Input id="oe-amount" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="oe-prop">Property</Label>
              <Select id="oe-prop" value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })}>
                <option value="">Company-wide</option>
                {(properties.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="oe-vendor">Vendor <span className="text-muted">(optional)</span></Label>
              <Input id="oe-vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. BPC" />
            </div>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" disabled={!valid || busy} onClick={submit}>
              {editing === 'new' ? 'Add cost' : 'Save changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
