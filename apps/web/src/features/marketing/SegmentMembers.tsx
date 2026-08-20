import { useState } from 'react';
import { Download, Phone, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMoney } from '@/lib/utils/money';
import { useSegmentMembers } from './hooks';
import type { SegmentKey, SegmentMember } from '@/types';

interface Props {
  segment: SegmentKey;
  label: string;
}

/**
 * Who is actually in a segment. The count on the card says "55 VIPs"; this says which ones
 * and how to reach them, which is the difference between a dashboard number and a list a
 * staff member can work through.
 *
 * Phone leads every row: the base migrated from Little Hotelier is 1,331 phone numbers
 * against 143 usable email addresses, so this is a calling list first.
 */
export function SegmentMembers({ segment, label }: Props) {
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, refetch } = useSegmentMembers(segment, search);

  if (isLoading) return <Spinner className="mx-auto my-8 h-6 w-6 text-slate-400" />;

  if (isError) {
    return (
      <EmptyState
        title="Couldn’t load the guest list"
        description="The server didn’t respond. Check the API is running and try again."
        action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  const members = data?.members ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <Input
            placeholder="Search name, company, phone or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs pl-9"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">
            {data?.total.toLocaleString('en')} in {label}
            {data?.truncated && ` — showing the first ${members.length}`}
          </span>
          {members.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => downloadMembersCsv(label, members)}>
              <Download className="h-4 w-4" /> Download list
            </Button>
          )}
        </div>
      </div>

      {members.length === 0 ? (
        <EmptyState
          title="No guests here"
          description={
            search
              ? 'No one in this segment matches your search. Try clearing it.'
              : 'This segment is empty. Guests move into it as they book, or as history is imported.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-line bg-cream text-left text-[11px] uppercase tracking-[0.12em] text-muted">
                <th className="px-3 py-2 font-normal">Guest</th>
                <th className="px-3 py-2 font-normal">Phone</th>
                <th className="px-3 py-2 font-normal">Email</th>
                <th className="px-3 py-2 text-right font-normal">Stays</th>
                <th className="px-3 py-2 text-right font-normal">Spend</th>
                <th className="px-3 py-2 text-right font-normal">Last stay</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <MemberRow key={m.id} member={m} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MemberRow({ member: m }: { member: SegmentMember }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-3 py-2">
        <div className="text-ink">{m.name}</div>
        {m.company && <div className="text-xs text-muted">{m.company}</div>}
      </td>
      <td className="px-3 py-2">
        {m.phone ? (
          <a href={`tel:${m.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 text-ink hover:text-terra">
            <Phone className="h-3.5 w-3.5 text-muted" />
            {m.phone}
          </a>
        ) : (
          <span className="text-xs text-faint">No number</span>
        )}
      </td>
      <td className="px-3 py-2">
        {m.email ? (
          <a href={`mailto:${m.email}`} className="text-ink hover:text-terra">{m.email}</a>
        ) : (
          <span className="text-xs text-faint">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {m.total_stays}
        {/* Migrated stays carry no dates or amounts, so the row says where the number came from
            rather than showing a spend of zero that reads like "never spent anything". */}
        {m.previous_stays > 0 && (
          <Badge tone="amber" className="ml-2">{m.previous_stays} imported</Badge>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {m.spend > 0 ? formatMoney(m.spend) : <span className="text-xs text-faint">Not recorded</span>}
      </td>
      <td className="px-3 py-2 text-right">
        {m.last_stay_days === null ? (
          <span className="text-xs text-faint">Unknown</span>
        ) : (
          `${m.last_stay_days} days ago`
        )}
      </td>
    </tr>
  );
}

const cell = (v: string | number | null) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The list as a CSV — for handing to whoever is making the calls, or for an SMS upload. */
export function downloadMembersCsv(label: string, members: SegmentMember[]): void {
  const rows = [
    'Name,Phone,Email,Company,Stays,Imported stays,Spend (BWP),Days since last stay',
    ...members.map((m) =>
      [
        cell(m.name), cell(m.phone), cell(m.email), cell(m.company),
        m.total_stays, m.previous_stays,
        m.spend > 0 ? (m.spend / 100).toFixed(2) : '',
        m.last_stay_days ?? '',
      ].join(',')
    ),
  ];
  const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `lifestyle-${label.toLowerCase().replace(/\s+/g, '-')}-guests.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
