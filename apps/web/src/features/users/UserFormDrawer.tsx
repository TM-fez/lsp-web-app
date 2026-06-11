import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/auth';
import { useCreateUser, useUpdateUser, useResetPassword } from './hooks';
import {
  ROLE_OPTIONS,
  roleLabel,
  roleHint,
  canTakeReceptionHat,
  hasReceptionHat,
  buildExtraPermissions,
  passwordIssue,
} from './util';
import type { RoleName, StaffUser } from '@/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: StaffUser | null;
  receptionPerms: string[];
}

export function UserFormDrawer({ open, onOpenChange, user, receptionPerms }: Props) {
  const isEdit = !!user;
  const me = useAuthStore((s) => s.user);
  const isSelf = isEdit && me?.id === user?.id;

  const create = useCreateUser();
  const update = useUpdateUser();
  const reset = useResetPassword();
  const busy = create.isPending || update.isPending || reset.isPending;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<RoleName>('reception');
  const [isLead, setIsLead] = useState(false);
  const [coversReception, setCoversReception] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
    setPassword('');
    setRole(user?.role ?? 'reception');
    setIsLead(user?.is_lead ?? false);
    setCoversReception(user ? hasReceptionHat(user.extra_permissions, receptionPerms) : false);
    setNewPassword('');
    setConfirmDeactivate(false);
  }, [open, user, receptionPerms]);

  const pwIssue = useMemo(() => (isEdit ? null : password ? passwordIssue(password) : null), [isEdit, password]);
  const valid =
    name.trim().length > 0 &&
    (isEdit || (/.+@.+\..+/.test(email.trim()) && password.length > 0 && !passwordIssue(password)));

  const showReceptionHat = canTakeReceptionHat(role);

  async function submit() {
    if (!valid) return;
    const extra_permissions = buildExtraPermissions({
      role,
      isLead,
      coversReception: showReceptionHat && coversReception,
      receptionPerms,
    });
    try {
      if (user) {
        await update.mutateAsync({
          id: user.id,
          input: { name: name.trim(), role, is_lead: isLead, extra_permissions },
        });
      } else {
        await create.mutateAsync({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          role,
          is_lead: isLead,
          extra_permissions,
        });
      }
      onOpenChange(false);
    } catch {
      /* hook surfaces the error toast; keep the drawer open */
    }
  }

  async function setActive(active: boolean) {
    if (!user) return;
    try {
      await update.mutateAsync({ id: user.id, input: { active } });
      onOpenChange(false);
    } catch {
      /* toast shown by hook */
    }
  }

  async function doResetPassword() {
    if (!user || passwordIssue(newPassword)) return;
    try {
      await reset.mutateAsync({ id: user.id, password: newPassword });
      setNewPassword('');
    } catch {
      /* toast shown by hook */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Manage ${user?.name}` : 'Add a staff member'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Change their role, rank or access. Email cannot be changed.'
              : 'They get their own login, scoped to their job. Share the details with them securely.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="user-name">Full name</Label>
            <Input
              id="user-name"
              placeholder="e.g. Ontiretse Olefile"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {!isEdit && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="user-email">Email (their login)</Label>
                <Input
                  id="user-email"
                  type="email"
                  placeholder="name@lsp.local"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="user-password">Temporary password</Label>
                <Input
                  id="user-password"
                  placeholder="e.g. Staff@123!"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {pwIssue && <span className="text-xs text-amber-600">{pwIssue}</span>}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="user-role">Role</Label>
            <Select
              id="user-role"
              value={role}
              disabled={isSelf}
              onChange={(e) => setRole(e.target.value as RoleName)}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {roleLabel[r]}
                </option>
              ))}
            </Select>
            <span className="text-xs text-slate-500">{roleHint[role]}</span>
            {isSelf && <span className="text-xs text-amber-600">You can’t change your own role.</span>}
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50/60 p-3">
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={isLead}
                onChange={(e) => setIsLead(e.target.checked)}
              />
              <span>
                <span className="font-medium">Team lead</span> (head / vice)
                {role === 'housekeeping' && (
                  <span className="block text-xs text-slate-500">
                    Housekeeping leads approve cleans — cleaners without this can’t mark a unit inspected.
                  </span>
                )}
              </span>
            </label>
            {showReceptionHat && (
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={coversReception}
                  onChange={(e) => setCoversReception(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Also covers reception</span>
                  <span className="block text-xs text-slate-500">
                    Adds front-desk access (bookings, guests, check-in/out) on top of their role.
                  </span>
                </span>
              </label>
            )}
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={busy || !valid}>
              {busy && <Spinner className="text-white" />} {isEdit ? 'Save changes' : 'Create login'}
            </Button>
          </div>

          {isEdit && (
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-4">
              <Label htmlFor="user-newpass">Reset password</Label>
              <div className="flex gap-2">
                <Input
                  id="user-newpass"
                  placeholder="New temporary password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={doResetPassword}
                  disabled={busy || !newPassword || !!passwordIssue(newPassword)}
                >
                  Reset
                </Button>
              </div>
              {newPassword && passwordIssue(newPassword) && (
                <span className="text-xs text-amber-600">{passwordIssue(newPassword)}</span>
              )}
              <span className="text-xs text-slate-500">Resetting signs them out everywhere.</span>
            </div>
          )}

          {isEdit && !isSelf && (
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-4">
              <Label className="text-rose-600">Danger zone</Label>
              {user?.active ? (
                !confirmDeactivate ? (
                  <Button variant="outline" onClick={() => setConfirmDeactivate(true)} disabled={busy}>
                    Deactivate this login
                  </Button>
                ) : (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 p-3">
                    <span className="text-sm text-rose-700">
                      Deactivate {user?.name}? They’re signed out and can’t log in until reactivated.
                    </span>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => setConfirmDeactivate(false)} disabled={busy}>
                        Keep
                      </Button>
                      <Button variant="danger" onClick={() => setActive(false)} disabled={busy}>
                        {busy && <Spinner className="text-white" />} Deactivate
                      </Button>
                    </div>
                  </div>
                )
              ) : (
                <Button variant="outline" onClick={() => setActive(true)} disabled={busy}>
                  Reactivate this login
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
