import { useState } from 'react';
import { Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/store/auth';
import { formatMoney } from '@/lib/utils/money';
import { cn } from '@/lib/utils/cn';
import { useExpenses, useApproveExpense, useReconcileExpense } from './hooks';
import type { ExpenseStatus } from '@/types';

const FILTERS: { key: ExpenseStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING', label: 'Pending approval' },
  { key: 'APPROVED', label: 'To reconcile' },
  { key: 'RECONCILED', label: 'Reconciled' },
];

const statusTone = { PENDING: 'amber', APPROVED: 'blue', RECONCILED: 'green' } as const;
const statusLabel = { PENDING: 'Pending approval', APPROVED: 'Approved', RECONCILED: 'Reconciled' } as const;

export function ExpensesPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canApprove = hasPerm('expenses.approve');
  const canReconcile = hasPerm('expenses.reconcile');

  const [filter, setFilter] = useState<ExpenseStatus | 'ALL'>('ALL');
  const { data: expenses, isLoading, isError, refetch } = useExpenses(filter === 'ALL' ? undefined : filter);
  const approve = useApproveExpense();
  const reconcile = useReconcileExpense();
  const busy = approve.isPending || reconcile.isPending;

  const total = (expenses ?? []).reduce((s, e) => s + e.cost_amount, 0);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex animate-rise flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-muted">
            <span className="h-px w-10 bg-ink" /> Finance · Gaborone
          </div>
          <h1 className="font-display text-4xl text-ink sm:text-5xl">Expenses</h1>
          <p className="mt-2 text-sm text-muted">Repair costs to approve and reconcile against the bank.</p>
        </div>
        {expenses && expenses.length > 0 && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Shown</div>
            <div className="font-display text-3xl tabnum text-ink">{formatMoney(total)}</div>
          </div>
        )}
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-xs transition-[background-color,color,border-color] duration-300',
              filter === f.key ? 'border-forest bg-forest text-cream' : 'border-line bg-paper text-char hover:border-ink',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn’t load expenses"
          description="The server didn’t respond. Try again."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      ) : (expenses?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Receipt className="h-8 w-8" />}
          title="Nothing here"
          description="When maintenance records a contractor cost on a repair, it lands here for a manager to approve and Accounts to reconcile."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-paper">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                <th className="px-4 py-3.5 font-medium">Repair</th>
                <th className="px-4 py-3.5 font-medium">Contractor</th>
                <th className="px-4 py-3.5 font-medium">Unit owner</th>
                <th className="px-4 py-3.5 text-right font-medium">Cost</th>
                <th className="px-4 py-3.5 font-medium">Status</th>
                <th className="px-4 py-3.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {(expenses ?? []).map((e) => (
                <tr key={e.id} className="border-b border-line transition-colors duration-300 last:border-0 hover:bg-cream-2">
                  <td className="px-4 py-3.5">
                    <div className="font-display text-lg text-ink">{e.title}</div>
                    <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{e.room_code ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3.5 text-muted">{e.contractor_name ?? '—'}</td>
                  <td className="px-4 py-3.5">
                    {e.room_ownership === 'LANDLORD' ? (
                      <>
                        <span className="text-amber-700">Landlord</span>
                        {e.landlord_name && <div className="text-xs text-muted">{e.landlord_name}</div>}
                      </>
                    ) : (
                      <span className="text-muted">Lifestyle</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right tabnum text-ink">{formatMoney(e.cost_amount)}</td>
                  <td className="px-4 py-3.5">
                    <Badge tone={statusTone[e.status]}>{statusLabel[e.status]}</Badge>
                    {e.status === 'RECONCILED' && e.cost_reconciled_by_name && (
                      <div className="mt-1 text-xs text-forest">✓ {e.cost_reconciled_by_name}</div>
                    )}
                    {e.status === 'APPROVED' && e.cost_approved_by_name && (
                      <div className="mt-1 text-xs text-muted">approved · {e.cost_approved_by_name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex justify-end gap-2">
                      {e.status === 'PENDING' && canApprove && (
                        <Button size="sm" variant="primary" disabled={busy} onClick={() => approve.mutate(e.id)}>
                          Approve spend
                        </Button>
                      )}
                      {e.status === 'APPROVED' && canReconcile && (
                        <Button size="sm" variant="primary" disabled={busy} onClick={() => reconcile.mutate(e.id)}>
                          Reconcile
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
