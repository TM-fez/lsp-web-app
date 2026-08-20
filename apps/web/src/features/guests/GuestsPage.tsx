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
import { SegmentMembers } from '@/features/marketing/SegmentMembers';
import type { Contact, ContactType, SegmentKey } from '@/types';

// Mirrors the labels the marketing service returns, so a segment reads the same on both
// screens. 'past' exists because migrated guests have a stay count but no dates — see
// migration 062.
const SEGMENTS: { key: SegmentKey; label: string }[] = [
  { key: 'vip', label: 'VIP' },
  { key: 'frequent', label: 'Frequent' },
  { key: 'recent', label: 'Recent' },
  { key: 'lapsed', label: 'Lapsed' },
  { key: 'past', label: 'Past guest' },
  { key: 'prospect', label: 'Prospects' },
];

const fmtDate = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

export function GuestsPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canCreate = hasPerm('crm.contacts.create');
  const canDelete = hasPerm('crm.contacts.delete');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | ContactType>('ALL');
  const [sort, setSort] = useState<'recent' | 'stays'>('recent');
  const [segment, setSegment] = useState<SegmentKey | 'ALL'>('ALL');
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
      sort: sort === 'stays' ? ('stays' as const) : undefined,
    }),
    [search, typeFilter, sort],
  );

  const {
    data, isLoading, isError, isFetching, refetch, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useGuests(params);
  const guests = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.total ?? 0;
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
          <h1 className="font-display text-4xl text-ink">Guests</h1>
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
          <Select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'recent' | 'stays')}
            className="max-w-[14rem]"
          >
            <option value="recent">Newest first</option>
            <option value="stays">Most previous stays</option>
          </Select>
          <Select
            value={segment}
            onChange={(e) => setSegment(e.target.value as SegmentKey | 'ALL')}
            className="max-w-[13rem]"
          >
            <option value="ALL">Every guest</option>
            {SEGMENTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </Select>
          {isFetching && <Spinner className="h-4 w-4 text-slate-400" />}
        </div>
      )}

      {segment !== 'ALL' ? (
        // Segment membership is computed from stays and spend, so it comes from the marketing
        // endpoint rather than the contacts list — one definition of "VIP", not two.
        <SegmentMembers
          segment={segment}
          label={SEGMENTS.find((s) => s.key === segment)!.label}
        />
      ) : isLoading ? (
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
        <div className="flex flex-col gap-3">
          <div className="border-t border-line">
            {guests.map((guest) => (
              <button
                key={guest.id}
                onClick={() => openEdit(guest)}
                className="group relative flex w-full items-center gap-5 overflow-hidden border-b border-line py-4 text-left"
              >
                <div className="absolute inset-0 origin-bottom scale-y-0 bg-forest transition-transform duration-500 ease-[cubic-bezier(.19,1,.22,1)] group-hover:scale-y-100" />
                <div className="relative min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-display text-xl text-ink transition-colors duration-500 group-hover:text-cream">
                      {guest.name}
                    </span>
                    <Badge tone={guest.type === 'company' ? 'green' : 'slate'} className="relative shrink-0 capitalize">
                      {guest.type}
                    </Badge>
                    {guest.previous_stays > 0 && (
                      <Badge tone="amber" className="relative shrink-0">
                        {guest.previous_stays} previous {guest.previous_stays === 1 ? 'stay' : 'stays'}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] uppercase tracking-[0.12em] text-muted transition-colors duration-500 group-hover:text-oncream">
                    {[guest.email, guest.phone, guest.company].filter(Boolean).join(' · ') || 'No contact details'}
                  </div>
                </div>
                <span className="relative hidden shrink-0 text-[11px] uppercase tracking-[0.12em] text-faint transition-colors duration-500 group-hover:text-oncream sm:block">
                  {fmtDate(guest.created_at)}
                </span>
                <span className="relative w-4 shrink-0 -translate-x-2 font-display text-xl text-terra opacity-0 transition-all duration-500 ease-[cubic-bezier(.19,1,.22,1)] group-hover:translate-x-0 group-hover:text-cream group-hover:opacity-100">
                  →
                </span>
              </button>
            ))}
          </div>
          {hasNextPage ? (
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? 'Loading…' : 'Load more guests'}
              </Button>
              <span className="text-xs text-muted">
                {`Showing ${guests.length.toLocaleString('en')} of ${total.toLocaleString('en')}`}
              </span>
            </div>
          ) : (
            total > 0 && (
              <p className="text-xs text-muted">
                {`All ${total.toLocaleString('en')} ${total === 1 ? 'guest' : 'guests'} shown.`}
              </p>
            )
          )}
        </div>
      )}

      <GuestFormDrawer open={drawerOpen} onOpenChange={setDrawerOpen} guest={editing} canDelete={canDelete} />
    </div>
  );
}
