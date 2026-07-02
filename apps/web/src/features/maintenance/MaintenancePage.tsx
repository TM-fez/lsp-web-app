import { useMemo, useState } from 'react';
import { Wrench, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/store/auth';
import { useRooms } from '@/features/rooms/hooks';
import { useWorkOrders, useStartWorkOrder, useCompleteWorkOrder, useApproveWorkOrder } from './hooks';
import { MaintenanceFormDrawer } from './MaintenanceFormDrawer';
import {
  FILTER_STATUSES,
  statusTone,
  statusLabel,
  priorityTone,
  priorityLabel,
  nextAction,
  actionLabel,
  fmtDate,
} from './util';
import type { WorkOrder, MaintenanceStatus } from '@/types';

export function MaintenancePage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canCreate = hasPerm('maintenance.create');
  const canUpdate = hasPerm('maintenance.update');
  // Contractors carry the narrower maintenance.work instead of maintenance.update.
  const canStart = canUpdate || hasPerm('maintenance.work');
  const canComplete = hasPerm('maintenance.complete');
  const canApprove = hasPerm('maintenance.approve');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MaintenanceStatus>('ALL');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | null>(null);

  const { data: rooms } = useRooms();
  const roomLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rooms ?? []) map.set(r.id, r.code);
    return (id: string) => map.get(id) ?? '—';
  }, [rooms]);

  const params = useMemo(
    () => ({ status: statusFilter === 'ALL' ? undefined : statusFilter }),
    [statusFilter],
  );
  const { data, isLoading, isError, isFetching, refetch } = useWorkOrders(params);

  const start = useStartWorkOrder();
  const complete = useCompleteWorkOrder();
  const approve = useApproveWorkOrder();
  const actionBusy = start.isPending || complete.isPending || approve.isPending;

  const orders = data?.data ?? [];
  const total = data?.total ?? 0;
  const q = search.trim().toLowerCase();
  const shown = q
    ? orders.filter(
        (o) => o.title.toLowerCase().includes(q) || roomLabel(o.room_id).toLowerCase().includes(q),
      )
    : orders;
  const hasQuery = q !== '' || statusFilter !== 'ALL';
  const truncated = !q && total > orders.length;

  const countLabel = !data
    ? 'Track every repair'
    : hasQuery
      ? `${shown.length} match${shown.length === 1 ? '' : 'es'}`
      : `${total} work order${total === 1 ? '' : 's'}`;

  function openCreate() {
    setEditing(null);
    setDrawerOpen(true);
  }
  function openManage(order: WorkOrder) {
    setEditing(order);
    setDrawerOpen(true);
  }

  function runAction(order: WorkOrder) {
    const action = nextAction[order.status];
    if (action === 'start') start.mutate(order.id);
    else if (action === 'complete') complete.mutate({ id: order.id });
  }
  const canDo = (action: 'start' | 'complete') => (action === 'complete' ? canComplete : canStart);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl text-ink">Maintenance</h1>
          <p className="text-sm text-slate-500">{countLabel}</p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Log repair
          </Button>
        )}
      </div>

      {!isLoading && !isError && (orders.length > 0 || hasQuery) && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search by repair or unit"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | MaintenanceStatus)}
            className="max-w-[11rem]"
          >
            <option value="ALL">All statuses</option>
            {FILTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel[s]}
              </option>
            ))}
          </Select>
          {isFetching && <Spinner className="h-4 w-4 text-slate-400" />}
        </div>
      )}

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn’t load work orders"
          description="The server didn’t respond. Check the API is running and try again."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      ) : orders.length === 0 && !hasQuery ? (
        <EmptyState
          icon={<Wrench className="h-8 w-8" />}
          title="No repairs logged yet"
          description="Log a repair when something breaks — a leaking tap, a broken aircon. The unit is held out of service until it’s fixed, so nobody books a room that isn’t ready."
          action={
            canCreate ? (
              <Button variant="primary" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Log your first repair
              </Button>
            ) : (
              <span className="text-xs text-slate-400">
                Ask an admin for the “maintenance.create” permission to log repairs.
              </span>
            )
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState title="No matches" description="No work orders match your search or filter. Try clearing them." />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-lg border border-line bg-paper">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                  <th className="px-4 py-3.5 font-medium">Repair</th>
                  <th className="px-4 py-3.5 font-medium">Unit</th>
                  <th className="px-4 py-3.5 font-medium">Assigned to</th>
                  <th className="px-4 py-3.5 font-medium">Priority</th>
                  <th className="px-4 py-3.5 font-medium">Status</th>
                  <th className="px-4 py-3.5 font-medium">Opened</th>
                  <th className="px-4 py-3.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((order) => {
                  const action = nextAction[order.status];
                  return (
                    <tr key={order.id} className="border-b border-line last:border-0 transition-colors duration-300 hover:bg-cream-2">
                      <td className="px-4 py-3.5">
                        <div className="font-display text-lg text-ink">{order.title}</div>
                        {order.description && (
                          <div className="max-w-md truncate text-xs text-muted">{order.description}</div>
                        )}
                      </td>
                      <td className="tabnum px-4 py-3.5 text-ink">{roomLabel(order.room_id)}</td>
                      <td className="px-4 py-3.5 text-muted">
                        {order.assigned_to_name ?? <span className="text-faint">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge tone={priorityTone[order.priority]}>{priorityLabel(order.priority)}</Badge>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge tone={statusTone[order.status]}>{statusLabel[order.status]}</Badge>
                        {order.status === 'COMPLETED' &&
                          (order.approved_at ? (
                            <div className="mt-1 text-xs text-forest">
                              ✓ Approved{order.approved_by_name ? ` · ${order.approved_by_name}` : ''}
                            </div>
                          ) : (
                            <div className="mt-1 text-xs text-terra">Awaiting approval</div>
                          ))}
                      </td>
                      <td className="px-4 py-3.5 text-muted">{fmtDate(order.opened_at ?? order.created_at)}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex justify-end gap-2">
                          {action && canDo(action) && (
                            <Button size="sm" variant="primary" disabled={actionBusy} onClick={() => runAction(order)}>
                              {actionLabel[action]}
                            </Button>
                          )}
                          {order.status === 'COMPLETED' && !order.approved_at && canApprove && (
                            <Button size="sm" variant="primary" disabled={actionBusy} onClick={() => approve.mutate(order.id)}>
                              Approve
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => openManage(order)}>
                            {canUpdate ? 'Manage' : 'View'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {truncated && (
            <p className="text-xs text-slate-400">
              Showing the first {orders.length} of {total}. Filter by status to narrow results.
            </p>
          )}
        </div>
      )}

      <MaintenanceFormDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        order={editing}
        rooms={rooms ?? []}
        canUpdate={canUpdate}
      />
    </div>
  );
}
