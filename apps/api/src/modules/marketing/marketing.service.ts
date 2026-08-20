import {
  isLlmConfigured as realIsLlmConfigured,
  generateText as realGenerateText,
  type GenerateTextOptions,
} from '../../core/llm/llm.service.js';
import type { ReportsResponse } from '../reports/reports.types.js';
import { MarketingRepository } from './marketing.repository.js';
import {
  SEGMENT_KEYS, type SegmentKey, type SegmentSummary, type SegmentsResponse,
  type GenerateCampaignDTO, type CampaignResponse, type StrategyResponse,
  type SegmentMember, type SegmentMembersResponse,
} from './marketing.types.js';

const num = (v: string | number | null | undefined) => Number(v ?? 0);
const pula = (thebe: number) => `P${Math.round(thebe / 100).toLocaleString('en')}`;

// Segmentation thresholds (spend in thebe: P20,000 = 2,000,000).
const VIP_SPEND = 2_000_000;
const VIP_STAYS = 5;
const FREQUENT_STAYS = 3;
const LAPSED_DAYS = 180;

const SEGMENT_META: Record<SegmentKey, { label: string; description: string }> = {
  vip: { label: 'VIP', description: 'Top spenders and most frequent guests — your best customers.' },
  frequent: { label: 'Frequent', description: 'Three or more stays and still active — loyal regulars.' },
  recent: { label: 'Recent', description: 'One or two recent stays — nurture them into regulars.' },
  lapsed: { label: 'Lapsed', description: 'Stayed before but not in the last six months — win them back.' },
  past: {
    label: 'Past guest',
    description:
      'Stayed once or twice in the old booking system. We know they came, not when — so treat them as a cold list, not a recent one.',
  },
  prospect: { label: 'Prospects', description: 'Contacts and enquiries who have not stayed yet.' },
};

// One bucket per customer, by priority: VIP wins outright; otherwise a guest who
// hasn't returned in six months is a win-back (lapsed), then loyal regulars, then
// the rest; never-stayed contacts are prospects.
//
// Stays migrated from Little Hotelier count toward loyalty (migration 062) — a 100-booking
// account must not read as a cold prospect just because its history predates this system.
// They cannot count toward RECENCY though: the export carried no dates, so a guest with only
// migrated stays gets 'past' rather than 'recent', which would assert a visit we cannot date.
// Spend is untouched by this: no amounts survived the export, so VIP-by-spend still means
// money actually recorded in LSP.
function classify(s: {
  stays: number;
  previous_stays: number;
  spend: number;
  last_stay_days: number | null;
}): SegmentKey {
  const total = s.stays + s.previous_stays;
  if (total === 0) return 'prospect';
  if (s.spend >= VIP_SPEND || total >= VIP_STAYS) return 'vip';
  if (s.last_stay_days !== null && s.last_stay_days > LAPSED_DAYS) return 'lapsed';
  if (total >= FREQUENT_STAYS) return 'frequent';
  if (s.stays === 0) return 'past';
  return 'recent';
}

const BRAND_SYSTEM = [
  'You are the marketing and revenue strategist for Lifestyle, a serviced-apartments operator in Gaborone, Botswana.',
  'Write in warm, clear, professional British English. The currency is the Botswana Pula, written like P1,200.',
  'Be concrete and practical. Never invent guest names, prices, discounts, or facts you were not given.',
].join(' ');

function campaignPrompt(seg: SegmentSummary, dto: GenerateCampaignDTO): string {
  const goal = dto.goal && dto.goal.length > 0 ? dto.goal : 'encourage their next booking';
  return [
    `Draft a ${dto.channel} marketing campaign for our "${seg.label}" guest segment (${seg.description}).`,
    `Segment size: ${seg.count} guests. Average lifetime spend: ${pula(seg.avg_spend)}.`,
    `Campaign goal: ${goal}.`,
    '',
    dto.channel === 'email'
      ? 'Return: a subject line, a short body (up to 120 words) with a clear call to action, and two alternative subject lines.'
      : `Return: a concise ${dto.channel} message (up to 60 words) with a clear call to action, and one alternative version.`,
    'Address the segment warmly as a group; do not use placeholder tokens like [Name].',
  ].join('\n');
}

function strategyPrompt(m: StrategyResponse['metrics']): string {
  const props = m.properties
    .map((p) => `- ${p.name}: occupancy ${p.occupancy_pct ?? 'n/a'}%, revenue ${pula(p.revenue)}`)
    .join('\n');
  return [
    `Estate figures for ${m.from} to ${m.to}:`,
    `Occupancy ${m.occupancy_pct}%. Revenue ${pula(m.revenue)}. Net ${pula(m.net)} (margin ${m.margin_pct}%).`,
    'By property:',
    props || '- (no property data)',
    '',
    'Give 3 to 5 concrete, prioritised recommendations to lift occupancy and revenue over the next quarter.',
    'For each: the action, the reason, and a rough sense of effort versus impact.',
    'Be specific to serviced apartments in Gaborone. Keep the whole reply under 300 words.',
  ].join('\n');
}

// The slice of the LLM client this service needs — injected so both the dark and
// configured paths are unit-testable without env gymnastics.
export interface LlmPort {
  isLlmConfigured: () => boolean;
  generateText: (opts: GenerateTextOptions) => Promise<string>;
}
const defaultLlm: LlmPort = { isLlmConfigured: realIsLlmConfigured, generateText: realGenerateText };

export class MarketingService {
  constructor(
    private readonly repo: MarketingRepository,
    private readonly llm: LlmPort = defaultLlm,
  ) {}

  /** Deterministic guest segmentation — always works, even with the LLM dark. */
  async getSegments(): Promise<SegmentsResponse> {
    const rows = await this.repo.customerStats();

    const buckets = new Map<SegmentKey, { count: number; spend: number; members: Array<{ name: string; spend: number; stays: number }> }>();
    for (const key of SEGMENT_KEYS) buckets.set(key, { count: 0, spend: 0, members: [] });

    for (const row of rows) {
      const stat = {
        stays: num(row.stays),
        previous_stays: num(row.previous_stays),
        spend: num(row.spend),
        last_stay_days: row.last_stay_days === null ? null : num(row.last_stay_days),
      };
      const b = buckets.get(classify(stat))!;
      b.count += 1;
      b.spend += stat.spend;
      b.members.push({ name: row.name, spend: stat.spend, stays: stat.stays + stat.previous_stays });
    }

    const segments: SegmentSummary[] = SEGMENT_KEYS.map((key) => {
      const b = buckets.get(key)!;
      // Spend first, then stays — migrated guests carry no amounts, so spend alone would pick
      // the examples at random for any segment made mostly of them.
      const sample_names = b.members
        .sort((a, z) => z.spend - a.spend || z.stays - a.stays)
        .slice(0, 5)
        .map((m) => m.name);
      return {
        key,
        label: SEGMENT_META[key].label,
        description: SEGMENT_META[key].description,
        count: b.count,
        total_spend: b.spend,
        avg_spend: b.count > 0 ? Math.round(b.spend / b.count) : 0,
        sample_names,
      };
    });

    return { configured: this.llm.isLlmConfigured(), total_customers: rows.length, segments };
  }

  /** Draft campaign copy for a segment. Dark until keyed → copy is null. */
  /**
   * GET /marketing/segments/:key/members — who is actually in a segment.
   *
   * The summary answers "how many VIPs"; this answers "which ones, and how do I reach them",
   * which is the difference between a number on a dashboard and a list someone can work
   * through. Ordered by stays before spend: the migrated Little Hotelier guests carry no
   * amounts at all, so spend-first would rank the biggest accounts (UPenn, 100 stays) below
   * anyone who has spent a single Pula in LSP.
   *
   * Capped rather than paginated — the caller is building a call list or a CSV, not browsing.
   */
  async getSegmentMembers(
    key: SegmentKey,
    opts: { search?: string; limit?: number } = {},
  ): Promise<SegmentMembersResponse> {
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
    const needle = (opts.search ?? '').trim().toLowerCase();

    const rows = await this.repo.customerStats();
    const all: SegmentMember[] = [];

    for (const row of rows) {
      const stat = {
        stays: num(row.stays),
        previous_stays: num(row.previous_stays),
        spend: num(row.spend),
        last_stay_days: row.last_stay_days === null ? null : num(row.last_stay_days),
      };
      if (classify(stat) !== key) continue;
      if (needle && ![row.name, row.company, row.email, row.phone]
        .some((f) => (f ?? '').toLowerCase().includes(needle))) continue;

      all.push({
        id: row.id,
        name: row.name,
        company: row.company,
        phone: row.phone,
        email: row.email,
        stays: stat.stays,
        previous_stays: stat.previous_stays,
        total_stays: stat.stays + stat.previous_stays,
        spend: stat.spend,
        last_stay_days: stat.last_stay_days,
      });
    }

    all.sort((a, z) => z.total_stays - a.total_stays || z.spend - a.spend || a.name.localeCompare(z.name));

    return {
      key,
      label: SEGMENT_META[key].label,
      total: all.length,
      members: all.slice(0, limit),
      truncated: all.length > limit,
    };
  }

  async generateCampaign(dto: GenerateCampaignDTO): Promise<CampaignResponse> {
    const { segments } = await this.getSegments();
    const seg = segments.find((s) => s.key === dto.segment)!; // dto.segment is enum-validated
    if (!this.llm.isLlmConfigured()) {
      return { configured: false, segment: dto.segment, channel: dto.channel, copy: null };
    }
    const copy = await this.llm.generateText({ system: BRAND_SYSTEM, prompt: campaignPrompt(seg, dto), maxTokens: 700 });
    return { configured: true, segment: dto.segment, channel: dto.channel, copy };
  }

  /** Turn the P&L/occupancy dashboard into a strategy brief. Dark until keyed. */
  async getStrategy(reports: ReportsResponse): Promise<StrategyResponse> {
    const metrics: StrategyResponse['metrics'] = {
      from: reports.summary.from,
      to: reports.summary.to,
      occupancy_pct: reports.summary.occupancy_pct,
      revenue: reports.summary.revenue,
      net: reports.summary.net,
      margin_pct: reports.summary.margin_pct,
      properties: reports.by_property
        .slice(0, 6)
        .map((p) => ({ name: p.property_name, occupancy_pct: p.occupancy_pct, revenue: p.revenue })),
    };
    if (!this.llm.isLlmConfigured()) {
      return { configured: false, metrics, recommendations: null };
    }
    const recommendations = await this.llm.generateText({ system: BRAND_SYSTEM, prompt: strategyPrompt(metrics), maxTokens: 900 });
    return { configured: true, metrics, recommendations };
  }
}
