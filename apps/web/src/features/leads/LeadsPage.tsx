import { useEffect, useMemo, useState } from 'react';
import { MessageSquareText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/store/auth';
import { useLeads } from './hooks';
import { LeadFormDrawer } from './LeadFormDrawer';
import { LEAD_SOURCES, statusTone, statusLabel, sourceText, fmtDate } from './util';
import type { Lead, LeadStatus, LeadSource } from '@/types';

const FILTER_STATUSES: LeadStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'];

export function LeadsPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canCreate = hasPerm('crm.leads.create');
  const canDelete = hasPerm('crm.leads.delete');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | LeadStatus>('ALL');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | LeadSource>('ALL');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = useMemo(
    () => ({
      search: search.trim() || undefined,
      status: statusFilter === 'ALL' ? undefined : statusFilter,
      source: sourceFilter === 'ALL' ? undefined : sourceFilter,
    }),
    [search, statusFilter, sourceFilter],
  );

  const { data, isLoading, isError, isFetching, refetch } = useLeads(params);
  const leads = data?.data ?? [];
  const total = data?.total ?? 0;
  const truncated = total > leads.length;
  const hasQuery = search.trim() !== '' || statusFilter !== 'ALL' || sourceFilter !== 'ALL';

  const countLabel = !data
    ? 'Capture every enquiry'
    : hasQuery
      ? `${total} match${total === 1 ? '' : 'es'}`
      : `${total} enquir${total === 1 ? 'y' : 'ies'}`;

  function openCreate() {
    setEditing(null);
    setDrawerOpen(true);
  }
  function openEdit(lead: Lead) {
    setEditing(lead);
    setDrawerOpen(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl text-ink">Leads</h1>
          <p className="text-sm text-slate-500">{countLabel}</p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Log enquiry
          </Button>
        )}
      </div>

      {!isLoading && !isError && (leads.length > 0 || hasQuery) && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search enquiries or notes"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | LeadStatus)}
            className="max-w-[11rem]"
          >
            <option value="ALL">All stages</option>
            {FILTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
          <Select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as 'ALL' | LeadSource)}
            className="max-w-[11rem]"
          >
            <option value="ALL">All sources</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {sourceText(s)}
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
          title="Couldn’t load enquiries"
          description="The server didn’t respond. Check the API is running and try again."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      ) : leads.length === 0 && !hasQuery ? (
        <EmptyState
          icon={<MessageSquareText className="h-8 w-8" />}
          title="No enquiries captured yet"
          description="Log your first enquiry so nothing slips through. Every WhatsApp message, walk-in or call becomes a trackable lead — and you’ll finally see where demand comes from."
          action={
            canCreate ? (
              <Button variant="primary" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Log your first enquiry
              </Button>
            ) : (
              <span className="text-xs text-slate-400">
                Ask an admin for the “crm.leads.create” permission to log enquiries.
              </span>
            )
          }
        />
      ) : leads.length === 0 ? (
        <EmptyState title="No matches" description="No enquiries match your search or filters. Try clearing them." />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="border-t border-line">
            {leads.map((lead) => (
              <button
                key={lead.id}
                onClick={() => openEdit(lead)}
                className="group relative flex w-full items-center gap-5 overflow-hidden border-b border-line py-4 text-left"
              >
                <div className="absolute inset-0 origin-bottom scale-y-0 bg-forest transition-transform duration-500 ease-[cubic-bezier(.19,1,.22,1)] group-hover:scale-y-100" />
                <div className="relative min-w-0 flex-1">
                  <div className="truncate font-display text-xl text-ink transition-colors duration-500 group-hover:text-cream">
                    {lead.title}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] uppercase tracking-[0.12em] text-muted transition-colors duration-500 group-hover:text-oncream">
                    {lead.source ? sourceText(lead.source) : 'No source'}
                    {lead.description ? ` · ${lead.description}` : ''}
                  </div>
                </div>
                <span className="relative hidden shrink-0 text-[11px] uppercase tracking-[0.12em] text-faint transition-colors duration-500 group-hover:text-oncream sm:block">
                  {fmtDate(lead.created_at)}
                </span>
                <Badge tone={statusTone[lead.status]} className="relative shrink-0">
                  {statusLabel(lead.status)}
                </Badge>
                <span className="relative w-4 shrink-0 -translate-x-2 font-display text-xl text-terra opacity-0 transition-all duration-500 ease-[cubic-bezier(.19,1,.22,1)] group-hover:translate-x-0 group-hover:text-cream group-hover:opacity-100">
                  →
                </span>
              </button>
            ))}
          </div>
          {truncated && (
            <p className="text-xs text-muted">
              Showing the first {leads.length} of {total}. Refine your search to narrow results.
            </p>
          )}
        </div>
      )}

      <LeadFormDrawer open={drawerOpen} onOpenChange={setDrawerOpen} lead={editing} canDelete={canDelete} />
    </div>
  );
}
