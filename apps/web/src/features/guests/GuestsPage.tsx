import { useEffect, useMemo, useState } from 'react';
import { Users, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/store/auth';
import { useGuests } from './hooks';
import { GuestFormDrawer } from './GuestFormDrawer';
import type { Contact, ContactType } from '@/types';

const fmtDate = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

const dash = <span className="text-slate-300">—</span>;

export function GuestsPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canCreate = hasPerm('crm.contacts.create');
  const canUpdate = hasPerm('crm.contacts.update');
  const canDelete = hasPerm('crm.contacts.delete');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | ContactType>('ALL');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);

  // Debounce the search box so we hit the API at most ~3x/second while typing.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = useMemo(
    () => ({
      search: search.trim() || undefined,
      type: typeFilter === 'ALL' ? undefined : typeFilter,
    }),
    [search, typeFilter],
  );

  const { data, isLoading, isError, isFetching, refetch } = useGuests(params);
  const guests = data?.data ?? [];
  const total = data?.total ?? 0;
  const truncated = total > guests.length;
  const hasQuery = search.trim() !== '' || typeFilter !== 'ALL';

  const countLabel = !data
    ? 'Manage your guest directory'
    : hasQuery
      ? `${total} match${total === 1 ? '' : 'es'}`
      : `${total} guest${total === 1 ? '' : 's'} in the directory`;

  function openCreate() {
    setEditing(null);
    setDrawerOpen(true);
  }
  function openEdit(guest: Contact) {
    setEditing(guest);
    setDrawerOpen(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Guests</h1>
          <p className="text-sm text-slate-500">{countLabel}</p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add guest
          </Button>
        )}
      </div>

      {!isLoading && !isError && (guests.length > 0 || hasQuery) && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search name, email or company"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'ALL' | ContactType)}
            className="max-w-[12rem]"
          >
            <option value="ALL">All types</option>
            <option value="individual">Individuals</option>
            <option value="company">Companies</option>
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
          title="Couldn’t load guests"
          description="The server didn’t respond. Check the API is running and try again."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      ) : guests.length === 0 && !hasQuery ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title="No guests yet"
          description="Add your first guest so they can be booked into reservations and recognised on arrival."
          action={
            canCreate ? (
              <Button variant="primary" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Add your first guest
              </Button>
            ) : (
              <span className="text-xs text-slate-400">
                Ask an admin for the “crm.contacts.create” permission to add guests.
              </span>
            )
          }
        />
      ) : guests.length === 0 ? (
        <EmptyState title="No matches" description="No guests match your search or filter. Try clearing them." />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-medium">Guest</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Added</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((guest) => (
                  <tr key={guest.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">{guest.name}</span>
                        <Badge tone={guest.type === 'company' ? 'violet' : 'slate'} className="capitalize">
                          {guest.type}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{guest.email || dash}</td>
                    <td className="px-4 py-3 text-slate-600">{guest.phone || dash}</td>
                    <td className="px-4 py-3 text-slate-600">{guest.company || dash}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(guest.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canUpdate ? (
                          <Button size="sm" variant="outline" onClick={() => openEdit(guest)}>
                            Edit
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
          {truncated && (
            <p className="text-xs text-slate-400">
              Showing the first {guests.length} of {total}. Refine your search to narrow results.
            </p>
          )}
        </div>
      )}

      <GuestFormDrawer open={drawerOpen} onOpenChange={setDrawerOpen} guest={editing} canDelete={canDelete} />
    </div>
  );
}
