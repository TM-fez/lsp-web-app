import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { useCreateLead, useUpdateLead, useDeleteLead } from './hooks';
import { USER_LEAD_STATUSES, LEAD_SOURCES, statusLabel, sourceLabel } from './util';
import type { SettableLeadStatus } from '@/lib/api/leads';
import type { Lead, LeadSource } from '@/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: Lead | null;
  canDelete?: boolean;
}

export function LeadFormDrawer({ open, onOpenChange, lead, canDelete }: Props) {
  const isEdit = !!lead;
  const create = useCreateLead();
  const update = useUpdateLead();
  const remove = useDeleteLead();
  const busy = create.isPending || update.isPending || remove.isPending;

  const [title, setTitle] = useState('');
  const [source, setSource] = useState<LeadSource | ''>('');
  const [status, setStatus] = useState<SettableLeadStatus>('NEW');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(lead?.title ?? '');
    setSource((lead?.source ?? '') as LeadSource | '');
    // CONVERTED is system-set and not expected here; fall back to NEW if seen.
    setStatus(
      lead && USER_LEAD_STATUSES.includes(lead.status as SettableLeadStatus)
        ? (lead.status as SettableLeadStatus)
        : 'NEW',
    );
    setPhone(lead?.phone ?? '');
    setDescription(lead?.description ?? '');
    setConfirmDelete(false);
  }, [open, lead]);

  const valid = title.trim().length > 0;

  async function submit() {
    if (!valid) return;
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      status,
      source: source || null,
      phone: phone.trim() || null,
    };
    try {
      if (lead) {
        await update.mutateAsync({ id: lead.id, input: payload });
      } else {
        await create.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch {
      /* hook surfaces the error toast; keep the drawer open */
    }
  }

  async function doDelete() {
    if (!lead) return;
    try {
      await remove.mutateAsync(lead.id);
      onOpenChange(false);
    } catch {
      /* toast shown by hook */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Manage enquiry' : 'Log an enquiry'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update this enquiry’s details and stage.'
              : 'Capture an enquiry so it’s tracked and never slips through — every WhatsApp, walk-in or call.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="lead-title">Enquiry</Label>
            <Input
              id="lead-title"
              placeholder="e.g. 2-bed for 3 weeks in August"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="lead-source">Source</Label>
              <Select
                id="lead-source"
                value={source}
                onChange={(e) => setSource(e.target.value as LeadSource | '')}
                disabled={busy}
              >
                <option value="">— Not set —</option>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {sourceLabel[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="lead-status">Stage</Label>
              <Select
                id="lead-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as SettableLeadStatus)}
                disabled={busy}
              >
                {USER_LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="lead-phone">Phone (optional)</Label>
            <Input
              id="lead-phone"
              placeholder="e.g. +267 71 000 000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={busy}
            />
            {isEdit && (
              <WhatsAppButton
                phone={phone}
                message="Hi, following up on your enquiry with Lifestyle —"
                className="mt-1 self-start"
              />
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="lead-desc">Notes (optional)</Label>
            <textarea
              id="lead-desc"
              rows={3}
              placeholder="What did they ask for? Dates, budget, contact details…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            />
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={busy || !valid}>
              {busy && <Spinner className="text-white" />} {isEdit ? 'Save changes' : 'Log enquiry'}
            </Button>
          </div>

          {isEdit && canDelete && (
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-4">
              <Label className="text-rose-600">Danger zone</Label>
              {!confirmDelete ? (
                <Button variant="outline" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  Remove this enquiry
                </Button>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 p-3">
                  <span className="text-sm text-rose-700">Remove this enquiry from the list?</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                      Keep
                    </Button>
                    <Button variant="danger" onClick={doDelete} disabled={busy}>
                      {busy && <Spinner className="text-white" />} Remove
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
