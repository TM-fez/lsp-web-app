import { useState } from 'react';
import { Sparkles, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils/cn';
import { useSegments, useGenerateCampaign, useStrategy } from './hooks';
import { SegmentMembers } from './SegmentMembers';
import type { CampaignChannel, SegmentKey, SegmentSummary } from '@/types';

const CHANNELS: CampaignChannel[] = ['email', 'whatsapp', 'sms'];

function compactPula(thebe: number): string {
  const p = thebe / 100;
  const a = Math.abs(p);
  if (a >= 1_000_000) return `P${(p / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `P${Math.round(p / 1_000)}k`;
  return `P${Math.round(p)}`;
}

// The banner shown whenever the LLM is dark — segments still work, generation doesn't.
function DarkBanner() {
  return (
    <div className="rounded-lg border border-terra/30 bg-terra/5 p-4">
      <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-terra">
        <Sparkles className="h-3.5 w-3.5" /> AI is switched off
      </div>
      <p className="text-sm text-char">
        Guest segments below are live. Campaign drafting and the strategy brief need Claude —
        set <code className="rounded bg-cream-2 px-1">ANTHROPIC_API_KEY</code> on the API to switch them on.
      </p>
    </div>
  );
}

function SegmentCard({ seg, active, onPick }: { seg: SegmentSummary; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'flex flex-col rounded-lg border p-4 text-left transition-[border-color,background-color]',
        active ? 'border-forest bg-forest/5' : 'border-line bg-paper hover:border-ink',
      )}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-display text-lg text-ink">{seg.label}</span>
        <span className="tabnum text-2xl text-ink">{seg.count}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{seg.description}</p>
      <div className="mt-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-muted">
        <span>Avg spend {compactPula(seg.avg_spend)}</span>
      </div>
      {seg.sample_names.length > 0 && (
        <p className="mt-1 truncate text-xs text-char" title={seg.sample_names.join(', ')}>
          {seg.sample_names.join(' · ')}
        </p>
      )}
    </button>
  );
}

export function MarketingPage() {
  const { data, isLoading, isError, refetch } = useSegments();
  const campaign = useGenerateCampaign();
  const strategy = useStrategy();
  const [selected, setSelected] = useState<SegmentKey | null>(null);
  const [channel, setChannel] = useState<CampaignChannel>('email');
  const [goal, setGoal] = useState('');

  const configured = data?.configured ?? false;
  const selectedSeg = data?.segments.find((s) => s.key === selected);

  const pick = (key: SegmentKey) => { setSelected(key); campaign.reset(); };
  const runCampaign = () => {
    if (selected) campaign.mutate({ segment: selected, channel, goal: goal.trim() || undefined });
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="animate-rise border-b border-line pb-5">
        <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-muted">
          <span className="h-px w-10 bg-ink" /> Marketing · Gaborone
        </div>
        <h1 className="font-display text-4xl text-ink sm:text-5xl">Marketing &amp; Strategy</h1>
        <p className="mt-2 text-sm text-muted">Segment the guest base, draft campaigns, and turn the numbers into a plan.</p>
      </header>

      {isLoading ? (
        <div className="flex h-60 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : isError || !data ? (
        <EmptyState
          title="Couldn’t load marketing"
          description="The server didn’t respond. Try again."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      ) : (
        <>
          {!configured && <DarkBanner />}

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-display text-xl text-ink">Guest segments</h2>
              <span className="text-xs text-muted">{data.total_customers.toLocaleString('en')} contacts</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.segments.map((seg) => (
                <SegmentCard key={seg.key} seg={seg} active={seg.key === selected} onPick={() => pick(seg.key)} />
              ))}
            </div>
          </section>

          {selectedSeg && (
            <section className="rounded-lg border border-line bg-paper p-5">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <h2 className="font-display text-xl text-ink">
                  {selectedSeg.label} — {selectedSeg.count.toLocaleString('en')}{' '}
                  {selectedSeg.count === 1 ? 'guest' : 'guests'}
                </h2>
                <span className="text-xs text-muted">{selectedSeg.description}</span>
              </div>
              <SegmentMembers segment={selectedSeg.key} label={selectedSeg.label} />
            </section>
          )}

          {selectedSeg && (
            <section className="rounded-lg border border-line bg-paper p-5">
              <div className="mb-4 flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-forest" />
                <h2 className="font-display text-xl text-ink">Draft a campaign — {selectedSeg.label}</h2>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.18em] text-muted">
                  Channel
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as CampaignChannel)}
                    className="h-9 rounded-md border border-line bg-paper px-3 text-sm capitalize text-ink"
                  >
                    {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-[11px] uppercase tracking-[0.18em] text-muted">
                  Goal (optional)
                  <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. fill weekday nights in August" className="h-9" />
                </label>
                <Button onClick={runCampaign} disabled={!configured || campaign.isPending}>
                  {campaign.isPending ? <Spinner className="mr-1.5 h-3.5 w-3.5" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                  Generate
                </Button>
              </div>
              {!configured && <p className="mt-2 text-xs text-terra">Switch on the Anthropic key to generate copy.</p>}
              {campaign.isError && <p className="mt-3 text-sm text-terra">Couldn’t generate — {campaign.error.message}</p>}
              {campaign.data?.copy && (
                <pre className="mt-4 whitespace-pre-wrap rounded-md border border-line bg-cream-2 p-4 font-sans text-sm text-ink">{campaign.data.copy}</pre>
              )}
            </section>
          )}

          <section className="rounded-lg border border-line bg-paper p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-forest" />
                <h2 className="font-display text-xl text-ink">AI strategy brief</h2>
              </div>
              <Button variant="outline" size="sm" onClick={() => strategy.mutate()} disabled={!configured || strategy.isPending}>
                {strategy.isPending ? <Spinner className="mr-1.5 h-3.5 w-3.5" /> : null}
                Generate brief
              </Button>
            </div>
            <p className="text-sm text-muted">Reads the estate’s occupancy and P&amp;L, then suggests where to focus next quarter.</p>
            {!configured && <p className="mt-2 text-xs text-terra">Switch on the Anthropic key to generate the brief.</p>}
            {strategy.isError && <p className="mt-3 text-sm text-terra">Couldn’t generate — {strategy.error.message}</p>}
            {strategy.data?.recommendations && (
              <>
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
                  <span>Occupancy <span className="tabnum text-ink">{strategy.data.metrics.occupancy_pct}%</span></span>
                  <span>Revenue <span className="tabnum text-ink">{compactPula(strategy.data.metrics.revenue)}</span></span>
                  <span>Net <span className="tabnum text-ink">{compactPula(strategy.data.metrics.net)}</span></span>
                  <span>Margin <span className="tabnum text-ink">{strategy.data.metrics.margin_pct}%</span></span>
                </div>
                <pre className="mt-3 whitespace-pre-wrap rounded-md border border-line bg-cream-2 p-4 font-sans text-sm text-ink">{strategy.data.recommendations}</pre>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
