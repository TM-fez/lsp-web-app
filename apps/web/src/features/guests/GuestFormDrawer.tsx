import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useCreateGuest, useUpdateGuest, useDeleteGuest } from './hooks';
import type { Contact, ContactType } from '@/types';

const TYPES: ContactType[] = ['individual', 'company'];
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guest?: Contact | null;
  canDelete?: boolean;
}

export function GuestFormDrawer({ open, onOpenChange, guest, canDelete }: Props) {
  const isEdit = !!guest;
  const create = useCreateGuest();
  const update = useUpdateGuest();
  const remove = useDeleteGuest();
  const busy = create.isPending || update.isPending || remove.isPending;

  const [type, setType] = useState<ContactType>('individual');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType(guest?.type ?? 'individual');
    setName(guest?.name ?? '');
    setEmail(guest?.email ?? '');
    setPhone(guest?.phone ?? '');
    setCompany(guest?.company ?? '');
    setAddress(guest?.address ?? '');
    setNotes(guest?.notes ?? '');
    setConfirmDelete(false);
  }, [open, guest]);

  const emailValid = email.trim() === '' || emailOk(email.trim());
  const valid = name.trim().length > 0 && emailValid;

  async function submit() {
    if (!valid) return;
    const payload = {
      type,
      name: name.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      // `company` is only collected for individuals (their employer/affiliation);
      // for a company contact the name itself is the organisation.
      company: type === 'individual' ? company.trim() || null : null,
      address: address.trim() || null,
      notes: notes.trim() || null,
    };
    try {
      if (guest) {
        await update.mutateAsync({ id: guest.id, input: payload });
      } else {
        await create.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch {
      /* hook surfaces the error toast; keep the drawer open */
    }
  }

  async function doDelete() {
    if (!guest) return;
    try {
      await remove.mutateAsync(guest.id);
      onOpenChange(false);
    } catch {
      /* toast shown by hook */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${guest?.name}` : 'Add a guest'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update this guest’s contact details.'
              : 'Add a guest so they can be booked into a reservation and recognised on arrival.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="guest-type">Type</Label>
              <Select id="guest-type" value={type} onChange={(e) => setType(e.target.value as ContactType)}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="guest-phone">Phone</Label>
              <Input
                id="guest-phone"
                placeholder="e.g. +267 71 000 000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="guest-name">{type === 'company' ? 'Company name' : 'Full name'}</Label>
            <Input
              id="guest-name"
              placeholder={type === 'company' ? 'e.g. Acme (Pty) Ltd' : 'e.g. Kefilwe Moeng'}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="guest-email">Email</Label>
            <Input
              id="guest-email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {!emailValid && <span className="text-xs text-rose-600">Enter a valid email or leave it blank.</span>}
          </div>

          {type === 'individual' && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="guest-company">Company / organisation (optional)</Label>
              <Input
                id="guest-company"
                placeholder="Employer or affiliation"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="guest-address">Address (optional)</Label>
            <Input
              id="guest-address"
              placeholder="City / postal address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="guest-notes">Notes (optional)</Label>
            <textarea
              id="guest-notes"
              rows={3}
              placeholder="Preferences, history, anything staff should know"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            />
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={busy || !valid}>
              {busy && <Spinner className="text-white" />} {isEdit ? 'Save changes' : 'Add guest'}
            </Button>
          </div>

          {isEdit && canDelete && (
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-4">
              <Label className="text-rose-600">Danger zone</Label>
              {!confirmDelete ? (
                <Button variant="outline" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  Remove this guest
                </Button>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 p-3">
                  <span className="text-sm text-rose-700">
                    Remove {guest?.name}? They’re archived — taken off the guest directory, but kept on record so their past bookings stay intact.
                  </span>
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
