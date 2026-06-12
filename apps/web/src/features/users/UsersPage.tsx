import { useMemo, useState } from 'react';
import { ShieldCheck, Plus, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/store/auth';
import { useUsers, useRoles } from './hooks';
import { UserFormDrawer } from './UserFormDrawer';
import { ROLE_OPTIONS, roleTone, roleLabel, hasReceptionHat } from './util';
import type { RoleName, StaffUser } from '@/types';

export function UsersPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canCreate = hasPerm('users.create');
  const canUpdate = hasPerm('users.update');

  const { data: users, isLoading, isError, refetch } = useUsers();
  const { data: roles } = useRoles();
  const receptionPerms = useMemo(
    () => roles?.find((r) => r.name === 'reception')?.permissions ?? [],
    [roles]
  );

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | RoleName>('ALL');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<StaffUser | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users ?? []).filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      if (!q) return true;
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    });
  }, [users, search, roleFilter]);

  function openCreate() {
    setEditing(null);
    setDrawerOpen(true);
  }
  function openEdit(user: StaffUser) {
    setEditing(user);
    setDrawerOpen(true);
  }

  const activeCount = users?.filter((u) => u.active).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl text-ink">Users &amp; Roles</h1>
          <p className="text-sm text-slate-500">
            {users
              ? `${activeCount} active login${activeCount === 1 ? '' : 's'} — each person sees only their part of the system`
              : 'Staff logins and what each person can see'}
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add staff member
          </Button>
        )}
      </div>

      {!isLoading && !isError && (users?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'ALL' | RoleName)}
            className="max-w-[12rem]"
          >
            <option value="ALL">All roles</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {roleLabel[r]}
              </option>
            ))}
          </Select>
        </div>
      )}

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn’t load staff"
          description="The server didn’t respond. Check the API is running and try again."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      ) : (users?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="No staff logins yet"
          description="Add your team so each person gets their own login scoped to their job — reception sees bookings, accounts sees money, housekeeping sees the cleaning board."
          action={
            canCreate ? (
              <Button variant="primary" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Add your first staff member
              </Button>
            ) : (
              <span className="text-xs text-slate-400">Ask an admin to add staff logins.</span>
            )
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matches" description="No staff match your search or filter. Try clearing them." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-medium">Staff member</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Extras</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 font-medium text-slate-900">
                      {user.name}
                      {user.is_lead && <Crown className="h-3.5 w-3.5 text-amber-500" aria-label="Team lead" />}
                    </div>
                    <div className="text-xs text-slate-500">{user.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={roleTone[user.role]}>{roleLabel[user.role]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {user.is_lead && <Badge tone="amber">Team lead</Badge>}
                      {hasReceptionHat(user.extra_permissions, receptionPerms) && (
                        <Badge tone="green">Covers reception</Badge>
                      )}
                      {!user.is_lead && !hasReceptionHat(user.extra_permissions, receptionPerms) && (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={user.active ? 'green' : 'slate'}>{user.active ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canUpdate ? (
                        <Button size="sm" variant="outline" onClick={() => openEdit(user)}>
                          Manage
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">View only</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UserFormDrawer open={drawerOpen} onOpenChange={setDrawerOpen} user={editing} receptionPerms={receptionPerms} />
    </div>
  );
}
