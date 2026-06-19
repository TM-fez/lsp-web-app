import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Repeat, Plus, Pencil, Trash2, Play } from 'lucide-react';
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
import { useRecurring, useCreateRecurring, useUpdateRecurring, useDeleteRecurring, useGenerateRecurring } from './hooks';
import type { RecurringCost, OperatingExpenseCategory } from '@/types';

const CATEGORIES: OperatingExpenseCategory[] = ['RENT', 'PAYROLL', 'UTILITIES', 'MARKETING', 'INSURANCE', 'SUPPLIES', 'SOFTWARE', 'OTHER'];
const catLabel = (c: OperatingExpenseCategory) => c.charAt(0) + c.slice(1).toLowerCase();
const monthName = new Date().toLocaleString('en', { month: 'long' });

interface FormState {
  category: OperatingExpenseCategory; description: string; vendor: string;
  amount: string; day_of_month: string; property_id: string; active: boolean;
}
const empty = (): FormState => ({ category: 'RENT', description: '', vendor: '', amount: '', day_of_month: '1', property_id: '', active: true });
const formFor = (r: RecurringCost): FormState => ({
  category: r.category, description: r.description, vendor: r.vendor ?? '',
  amount: thebeToPula(r.amount), day_of_month: String(r.day_of_month),
  property_id: r.property_id ?? '', active: r.active,
});

export function RecurringView() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canCreate = hasPerm('opex.create');
  const canUpdate = hasPerm('opex.update');
  const canDelete = hasPerm('opex.delete');

  const { data, isLoading, isError, refetch } = useRecurring();
  const properties = useQuery({ queryKey: ['properties'], queryFn: listProperties });
  const create = useCreateRecurring();
  const update = useUpdateRecurring();
  const remove = useDeleteRecurring();
  const generate = useGenerateRecurring();
  const busy = create.isPending || update.isPending || remove.isPending;

  const [editing, setEditing] = useState<RecurringCost | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(empty());

  const openNew = () => { setForm(empty()); setEditing('new'); };
  const openEdit = (r: RecurringCost) => { setForm(formFor(r)); setEditing(r); };

  const thebe = pulaToThebe(form.amount);
  const day = parseInt(form.day_of_month, 10);
  const valid = form.description.trim() && !Number.isNaN(thebe) && thebe > 0 && day >= 1 && day <= 28;

  const submit = () => {
    if (!valid) return;
    const payload = {
      category: form.category, description: form.description.trim(), vendor: form.vendor.trim() || null,
      amount: thebe, day_of_month: day, property_id: form.property_id || null, active: form.active,
    };
    const done = { onSuccess: () => setEditing(null) };
    if (editing === 'new') create.mutate(payload, done);
    else if (editing) update.mutate({ id: editing.id, input: payload }, done);
  };

  const rows = data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Templates that post one cost each month. Generate runs them for the current month (skips any already posted).</p>
        <div className="flex gap-2">
          {canCreate && rows.length > 0 && (
            <Button variant="primary" disabled={generate.isPending} onClick={() => generate.mutate(undefined)}>
              <Play className="mr-1.5 h-4 w-4" />Generate {monthName}
            </Button>
          )}
          {canCreate && <Button variant="outline" onClick={openNew}><Plus className="mr-1.5 h-4 w-4" />Add recurring</Button>}
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : isError ? (
        <EmptyState title="Couldn’t load templates" description="Try again."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Repeat className="h-8 w-8" />} title="No recurring costs"
          description="Add rent, insurance, software and other monthly overheads once — then generate them each month with a click."
          action={canCreate ? <Button variant="primary" onClick={openNew}>Add the first one</Button> : undefined} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-paper">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                <th className="px-4 py-3.5 font-medium">Category</th>
                <th className="px-4 py-3.5 font-medium">Description</th>
                <th className="px-4 py-3.5 font-medium">Each month on</th>
                <th className="px-4 py-3.5 text-right font-medium">Amount</th>
                <th className="px-4 py-3.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-b border-line last:border-0 hover:bg-cream-2 ${!r.active ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3.5"><Badge tone="slate">{catLabel(r.category)}</Badge>{!r.active && <span className="ml-2 text-[11px] uppercase tracking-[0.12em] text-muted">paused</span>}</td>
                  <td className="px-4 py-3.5 text-ink">{r.description}{r.vendor && <span className="block text-xs text-muted">{r.vendor}</span>}</td>
                  <td className="px-4 py-3.5 text-muted">day {r.day_of_month}{r.property_name ? ` · ${r.property_name}` : ''}</td>
                  <td className="px-4 py-3.5 text-right tabnum text-ink">{formatMoney(r.amount)}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex justify-end gap-1.5">
                      {canUpdate && <Button size="sm" variant="outline" disabled={busy} onClick={() => openEdit(r)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>}
                      {canDelete && <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (confirm('Remove this recurring cost?')) remove.mutate(r.id); }} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>}
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
            <DialogTitle>{editing === 'new' ? 'Add recurring cost' : 'Edit recurring cost'}</DialogTitle>
            <DialogDescription>Posts automatically each month when you press Generate. Amount in Pula.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-cat">Category</Label>
              <Select id="rc-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as OperatingExpenseCategory })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-day">Day of month (1–28)</Label>
              <Input id="rc-day" inputMode="numeric" value={form.day_of_month} onChange={(e) => setForm({ ...form, day_of_month: e.target.value })} />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="rc-desc">Description</Label>
              <Input id="rc-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Monthly rent — Village" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-amt">Amount (Pula)</Label>
              <Input id="rc-amt" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rc-prop">Property</Label>
              <Select id="rc-prop" value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })}>
                <option value="">Company-wide</option>
                {(properties.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="rc-vendor">Vendor <span className="text-muted">(optional)</span></Label>
              <Input id="rc-vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm text-char">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active (included when you generate the month)
            </label>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" disabled={!valid || busy} onClick={submit}>{editing === 'new' ? 'Add' : 'Save'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
