import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { useAuthStore } from '@/store/auth';
import {
  useCreateWorkOrder,
  useUpdateWorkOrder,
  useCancelWorkOrder,
  useAssignWorkOrder,
  useApproveWorkOrder,
  useSetWorkOrderCost,
  useStaffDirectory,
} from './hooks';
import { PRIORITIES, priorityLabel, statusLabel, statusTone, isClosed, fmtDate } from './util';
import type { WorkOrder, Room, MaintenancePriority } from '@/types';

/** Read-only "who did what" summary shown in the manage/record drawer. */
function People({ order }: { order: WorkOrder }) {
  const rows: [string, string | null | undefined][] = [
    ['Reported by', order.reported_by_name],
    ['Assigned to', order.assigned_to_name],
    ['Completed by', order.completed_by_name],
    ['Approved by', order.approved_by_name],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 rounded-md border border-slate-100 bg-slate-50/60 p-3 text-xs">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-slate-400">{label}</dt>
          <dd className="text-slate-700">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order?: WorkOrder | null;
  rooms: Room[];
  canUpdate?: boolean;
}

export function MaintenanceFormDrawer({ open, onOpenChange, order, rooms, canUpdate }: Props) {
  const isEdit = !!order;
  const closed = !!order && isClosed(order.status);
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canApprove = hasPerm('maintenance.approve');
  const create = useCreateWorkOrder();
  const update = useUpdateWorkOrder();
  const cancel = useCancelWorkOrder();
  const assign = useAssignWorkOrder();
  const approve = useApproveWorkOrder();
  const { data: staff } = useStaffDirectory();
  const setCostM = useSetWorkOrderCost();
  const busy = create.isPending || update.isPending || cancel.isPending || assign.isPending || approve.isPending || setCostM.isPending;

  const [roomId, setRoomId] = useState('');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<MaintenancePriority>('MEDIUM');
  const [description, setDescription] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [restoreUnit, setRestoreUnit] = useState(true);
  const [contractor, setContractor] = useState('');
  const [contractorPhone, setContractorPhone] = useState('');
  const [cost, setCost] = useState('');

  useEffect(() => {
    if (!open) return;
    setRoomId(order?.room_id ?? '');
    setTitle(order?.title ?? '');
    setPriority(order?.priority ?? 'MEDIUM');
    setDescription(order?.description ?? '');
    setConfirmCancel(false);
    setRestoreUnit(true);
    setContractor(order?.contractor_name ?? '');
    setContractorPhone(order?.contractor_phone ?? '');
    setCost(order?.cost_amount != null ? String(order.cost_amount / 100) : '');
  }, [open, order]);

  const unitLabel = (id: string) => {
    const r = rooms.find((x) => x.id === id);
    return r ? `${r.code} · ${r.name}` : '—';
  };

  const valid = title.trim().length > 0 && (isEdit || roomId !== '');

  async function submit() {
    if (!valid) return;
    try {
      if (order) {
        await update.mutateAsync({
          id: order.id,
          input: { title: title.trim(), description: description.trim() || null, priority },
        });
      } else {
        await create.mutateAsync({
          room_id: roomId,
          title: title.trim(),
          description: description.trim() || null,
          priority,
          contractor_name: contractor.trim() || null,
          contractor_phone: contractorPhone.trim() || null,
          cost_amount: cost ? Math.round(parseFloat(cost) * 100) : null,
        });
      }
      onOpenChange(false);
    } catch {
      /* hook surfaces the error toast; keep the drawer open */
    }
  }

  async function doCancel() {
    if (!order) return;
    try {
      await cancel.mutateAsync({ id: order.id, restoreRoom: restoreUnit });
      onOpenChange(false);
    } catch {
      /* toast shown by hook */
    }
  }

  async function saveCost() {
    if (!order) return;
    try {
      await setCostM.mutateAsync({
        id: order.id,
        input: {
          contractor_name: contractor.trim() || null,
          contractor_phone: contractorPhone.trim() || null,
          cost_amount: cost ? Math.round(parseFloat(cost) * 100) : null,
        },
      });
    } catch {
      /* toast shown by hook */
    }
  }

  // Closed work orders are read-only — show the record, no inputs.
  if (closed && order) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{order.title}</DialogTitle>
            <DialogDescription>This work order is closed and can’t be changed.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge tone={statusTone[order.status]}>{statusLabel[order.status]}</Badge>
              <span className="text-slate-500">Unit {unitLabel(order.room_id)}</span>
            </div>
            {order.description && <p className="whitespace-pre-line text-slate-600">{order.description}</p>}
            <dl className="grid grid-cols-2 gap-2 text-xs text-slate-500">
              <div>
                <dt className="text-slate-400">Opened</dt>
                <dd>{fmtDate(order.opened_at ?? order.created_at)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">{order.status === 'COMPLETED' ? 'Completed' : 'Cancelled'}</dt>
                <dd>{fmtDate((order.completed_at ?? order.cancelled_at) ?? order.created_at)}</dd>
              </div>
            </dl>
            <People order={order} />
            {order.status === 'COMPLETED' &&
              (order.approved_at ? (
                <p className="text-xs text-emerald-600">
                  ✓ Approved by {order.approved_by_name ?? 'a manager'} on {fmtDate(order.approved_at)}
                </p>
              ) : canApprove ? (
                <Button variant="primary" onClick={() => approve.mutate(order.id)} disabled={busy}>
                  {busy && <Spinner className="text-white" />} Approve this repair
                </Button>
              ) : (
                <p className="text-xs text-amber-600">Awaiting a manager’s approval.</p>
              ))}
          </div>
          <div className="flex justify-end pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Manage work order' : 'Log a repair'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update this work order’s details.'
              : 'Logging a repair marks the unit as under maintenance — it won’t be bookable until you mark the repair fixed.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="wo-unit">Unit</Label>
            {isEdit ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {unitLabel(roomId)}
              </div>
            ) : (
              <Select id="wo-unit" value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={busy}>
                <option value="">— Choose unit —</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} · {r.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div className="grid grid-cols-[1fr_10rem] gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="wo-title">Repair</Label>
              <Input
                id="wo-title"
                placeholder="e.g. Aircon not cooling"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="wo-priority">Priority</Label>
              <Select
                id="wo-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as MaintenancePriority)}
                disabled={busy}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabel(p)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="wo-desc">Details (optional)</Label>
            <textarea
              id="wo-desc"
              rows={3}
              placeholder="What’s wrong? Anything the person fixing it should know…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            />
          </div>

          {isEdit && order && canUpdate && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="wo-assign">Assign to</Label>
              <Select
                id="wo-assign"
                value={order.assigned_to ?? ''}
                onChange={(e) => assign.mutate({ id: order.id, assignedTo: e.target.value || null })}
                disabled={busy}
              >
                <option value="">— Unassigned —</option>
                {(staff ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-slate-500">The staff member responsible for this repair.</span>
            </div>
          )}

          {isEdit && order && <People order={order} />}

          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <Label className="text-[11px] uppercase tracking-[0.18em] text-muted">Contractor &amp; cost</Label>
            <div className="grid grid-cols-[1fr_9rem] gap-3">
              <Input
                placeholder="Contractor (e.g. Teko Plumbing)"
                value={contractor}
                onChange={(e) => setContractor(e.target.value)}
                disabled={busy}
              />
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">P</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  disabled={busy}
                  className="pl-7"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Contractor phone (e.g. +267 71 000 000)"
                value={contractorPhone}
                onChange={(e) => setContractorPhone(e.target.value)}
                disabled={busy}
              />
              <WhatsAppButton phone={contractorPhone} className="shrink-0" />
            </div>
            {isEdit && order ? (
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted">
                  {order.cost_amount == null
                    ? 'Recorded costs go to Accounts to approve.'
                    : order.cost_reconciled_at
                      ? '✓ Reconciled by Accounts'
                      : order.cost_approved_at
                        ? 'Approved — awaiting reconciliation'
                        : 'Pending manager approval'}
                </span>
                <Button variant="outline" size="sm" disabled={busy} onClick={saveCost}>
                  Save cost
                </Button>
              </div>
            ) : (
              <span className="text-xs text-muted">
                Optional — the outside contractor and what it costs. Accounts approves the spend.
              </span>
            )}
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={busy || !valid}>
              {busy && <Spinner className="text-white" />} {isEdit ? 'Save changes' : 'Log repair'}
            </Button>
          </div>

          {isEdit && canUpdate && (
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-4">
              <Label className="text-rose-600">Danger zone</Label>
              {!confirmCancel ? (
                <Button variant="outline" onClick={() => setConfirmCancel(true)} disabled={busy}>
                  Cancel this work order
                </Button>
              ) : (
                <div className="flex flex-col gap-3 rounded-md border border-rose-200 bg-rose-50 p-3">
                  <span className="text-sm text-rose-700">Cancel this work order?</span>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={restoreUnit}
                      onChange={(e) => setRestoreUnit(e.target.checked)}
                      disabled={busy}
                    />
                    Also set the unit back to available
                  </label>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setConfirmCancel(false)} disabled={busy}>
                      Keep
                    </Button>
                    <Button variant="danger" onClick={doCancel} disabled={busy}>
                      {busy && <Spinner className="text-white" />} Cancel work order
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
