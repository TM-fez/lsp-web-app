import { useState } from 'react';
import { Tags, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/store/auth';
import { formatMoney } from '@/lib/utils/money';
import { useRatePlans, useUpdateRatePlan } from './hooks';
import { RatePlanFormDrawer } from './RatePlanFormDrawer';
import type { RatePlan } from '@/types';

const unitLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function PricingPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canCreate = hasPerm('pricing.create');
  const canUpdate = hasPerm('pricing.update');

  const { data: plans, isLoading, isError, refetch } = useRatePlans();
  const toggle = useUpdateRatePlan();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<RatePlan | null>(null);

  function openCreate() {
    setEditing(null);
    setDrawerOpen(true);
  }
  function openEdit(plan: RatePlan) {
    setEditing(plan);
    setDrawerOpen(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl text-ink">Pricing</h1>
          <p className="text-sm text-slate-500">
            {plans ? `${plans.length} rate plan${plans.length === 1 ? '' : 's'}` : 'Set the rates quotes are built from'}
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add rate plan
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn’t load rate plans"
          description="The server didn’t respond. Check the API is running and try again."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      ) : (plans?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Tags className="h-8 w-8" />}
          title="No rate plans yet"
          description="Add a rate plan per unit type so the system can quote a price. Without one, bookings can’t calculate a deposit."
          action={
            canCreate ? (
              <Button variant="primary" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Add your first rate plan
              </Button>
            ) : (
              <span className="text-xs text-slate-400">Ask an admin for the “pricing.create” permission.</span>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Nightly</th>
                <th className="px-4 py-3 font-medium">Weekly</th>
                <th className="px-4 py-3 font-medium">Monthly</th>
                <th className="px-4 py-3 font-medium">Deposit</th>
                <th className="px-4 py-3 font-medium">Tax</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(plans ?? []).map((plan) => {
                const pending = toggle.isPending && toggle.variables?.id === plan.id;
                return (
                  <tr key={plan.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">{plan.name}</span>
                        <Badge tone={plan.active ? 'green' : 'slate'}>{plan.active ? 'active' : 'inactive'}</Badge>
                      </div>
                      {plan.updated_by_name && (
                        <div className="mt-0.5 text-xs text-slate-400">
                          Updated by {plan.updated_by_name}
                          {plan.updated_at ? ` · ${new Date(plan.updated_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{unitLabel(plan.unit_type)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatMoney(plan.nightly_rate, plan.currency)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatMoney(plan.weekly_rate, plan.currency)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatMoney(plan.monthly_rate, plan.currency)}</td>
                    <td className="px-4 py-3 text-slate-600">{plan.deposit_pct}%</td>
                    <td className="px-4 py-3 text-slate-600">{(plan.tax_rate_bps / 100).toFixed(plan.tax_rate_bps % 100 ? 2 : 0)}%</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canUpdate && pending && <Spinner />}
                        {canUpdate && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => toggle.mutate({ id: plan.id, input: { active: !plan.active } })}
                          >
                            {plan.active ? 'Deactivate' : 'Activate'}
                          </Button>
                        )}
                        {canUpdate ? (
                          <Button size="sm" variant="outline" onClick={() => openEdit(plan)}>
                            Edit
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-400">View only</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <RatePlanFormDrawer open={drawerOpen} onOpenChange={setDrawerOpen} plan={editing} canDelete={canUpdate} />
    </div>
  );
}
