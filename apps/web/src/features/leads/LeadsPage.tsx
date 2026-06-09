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
const dash = <span className="text-slate-300">—</span>;

export function LeadsPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canCreate = hasPerm('crm.leads.create');
  const canUpdate = hasPerm('crm.leads.update');
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
          <h1 className="text-xl font-semibold">Leads</h1>
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
        <div className="flex flex-col gap-2">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-medium">Enquiry</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Stage</th>
                  <th className="px-4 py-3 font-medium">Logged</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{lead.title}</div>
                      {lead.description && (
                        <div className="max-w-md truncate text-xs text-slate-400">{lead.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{lead.source ? sourceText(lead.source) : dash}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone[lead.status]}>{statusLabel(lead.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(lead.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        {canUpdate ? (
                          <Button size="sm" variant="outline" onClick={() => openEdit(lead)}>
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
          {truncated && (
            <p className="text-xs text-slate-400">
              Showing the first {leads.length} of {total}. Refine your search to narrow results.
            </p>
          )}
        </div>
      )}

      <LeadFormDrawer open={drawerOpen} onOpenChange={setDrawerOpen} lead={editing} canDelete={canDelete} />
    </div>
  );
}
