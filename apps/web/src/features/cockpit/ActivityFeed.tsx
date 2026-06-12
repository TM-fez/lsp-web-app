import { useQuery } from '@tanstack/react-query';
import { listActivity } from '@/lib/api/activity';

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** The shared "what's changed" feed — a price edit, an approval, a new booking —
 *  so no one on the team is caught by surprise. Visible to all staff. */
export function ActivityFeed() {
  const { data } = useQuery({
    queryKey: ['activity'],
    queryFn: () => listActivity(14),
    refetchInterval: 30_000,
  });
  const items = data ?? [];
  if (items.length === 0) return null;

  return (
    <section className="animate-rise">
      <div className="mb-4 flex items-baseline gap-3 border-b border-line pb-3">
        <h2 className="font-display text-2xl text-ink">Lately</h2>
        <span className="font-display text-sm italic text-muted">( across the house )</span>
      </div>
      <ul className="flex flex-col">
        {items.map((it) => (
          <li key={it.id} className="flex items-baseline gap-3 border-b border-line py-2.5 last:border-0">
            <span className="h-1.5 w-1.5 shrink-0 translate-y-1.5 rounded-full bg-terra/70" />
            <span className="text-sm">
              <span className="font-medium text-ink">{it.actor}</span>{' '}
              <span className="text-muted">{it.action}</span>
            </span>
            <span className="ml-auto shrink-0 text-[11px] uppercase tracking-[0.1em] text-faint">{timeAgo(it.created_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
