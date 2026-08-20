import { describe, it, expect, vi } from 'vitest';
import { MarketingService, type LlmPort } from '../../../src/modules/marketing/marketing.service.js';
import type { MarketingRepository, CustomerStat } from '../../../src/modules/marketing/marketing.repository.js';
import type { ReportsResponse } from '../../../src/modules/reports/reports.types.js';

// One customer per intended segment (spend in thebe; P20,000 = 2,000,000).
const ROWS: CustomerStat[] = [
  { id: '1', name: 'Kagiso Holdings', email: null, phone: null, company: 'Kagiso', stays: 2, previous_stays: 0, spend: 2_500_000, last_stay_days: 10 },  // vip (spend)
  { id: '2', name: 'Frequent Flyer', email: null, phone: null, company: null, stays: 6, previous_stays: 0, spend: 500_000, last_stay_days: 20 },        // vip (stays)
  { id: '3', name: 'Loyal Three', email: null, phone: null, company: null, stays: 3, previous_stays: 0, spend: 300_000, last_stay_days: 30 },           // frequent
  { id: '4', name: 'Newbie', email: null, phone: null, company: null, stays: 1, previous_stays: 0, spend: 100_000, last_stay_days: 15 },                // recent
  { id: '5', name: 'Long Gone', email: null, phone: null, company: null, stays: 2, previous_stays: 0, spend: 400_000, last_stay_days: 400 },            // lapsed
  { id: '6', name: 'Never Stayed', email: null, phone: null, company: null, stays: 0, previous_stays: 0, spend: 0, last_stay_days: null },              // prospect
];

// Guests carried over from Little Hotelier: a stay COUNT and nothing else — no dates, no
// amounts. They must count toward loyalty but never toward recency.
const MIGRATED: CustomerStat[] = [
  { id: 'm1', name: 'University of Pennsylvania', email: null, company: null, stays: 0, previous_stays: 100, spend: 0, last_stay_days: null },
  { id: 'm2', name: 'Loyal Legacy', email: null, company: null, stays: 0, previous_stays: 3, spend: 0, last_stay_days: null },
  { id: 'm3', name: 'Stayed Twice Long Ago', email: null, company: null, stays: 0, previous_stays: 2, spend: 0, last_stay_days: null },
  { id: 'm4', name: 'Straddler', email: null, company: null, stays: 2, previous_stays: 3, spend: 0, last_stay_days: 20 },
];

const repoWith = (rows: CustomerStat[]): MarketingRepository =>
  ({ customerStats: async () => rows }) as unknown as MarketingRepository;

const darkLlm: LlmPort = { isLlmConfigured: () => false, generateText: vi.fn() };
const liveLlm = (reply: string): LlmPort => ({
  isLlmConfigured: () => true,
  generateText: vi.fn().mockResolvedValue(reply),
});

const REPORTS: ReportsResponse = {
  summary: {
    from: '2025-07-01', to: '2026-06-30', revenue: 100_000_000, maintenance_cost: 0, operating_expenses: 0,
    total_cost: 0, net: 40_000_000, margin_pct: 40, vat_output: 0, reservations: 100,
    room_nights_booked: 1000, room_nights_available: 3000, occupancy_pct: 33.3,
  },
  monthly: [],
  by_property: [
    { property_id: 'p1', property_name: 'Village', revenue: 80_000_000, maintenance_cost: 0, operating_expenses: 0, net: 80_000_000, occupancy_pct: 35 },
  ],
};

describe('MarketingService — segmentation (deterministic)', () => {
  it('buckets each customer into exactly one segment by priority', async () => {
    const { segments, total_customers, configured } = await new MarketingService(repoWith(ROWS), darkLlm).getSegments();
    const by = Object.fromEntries(segments.map((s) => [s.key, s]));
    expect(total_customers).toBe(6);
    expect(configured).toBe(false);
    expect(by.vip!.count).toBe(2);
    expect(by.frequent!.count).toBe(1);
    expect(by.recent!.count).toBe(1);
    expect(by.lapsed!.count).toBe(1);
    expect(by.prospect!.count).toBe(1);
  });

  it('counts migrated stays toward loyalty — a 100-booking account is not a prospect', async () => {
    const { segments } = await new MarketingService(repoWith(MIGRATED), darkLlm).getSegments();
    const by = Object.fromEntries(segments.map((s) => [s.key, s]));
    // UPenn (100) and the straddler (2 live + 3 migrated = 5) clear the VIP threshold.
    expect(by.vip!.count).toBe(2);
    expect(by.vip!.sample_names[0]).toBe('University of Pennsylvania'); // ranked by stays, spend being 0
    expect(by.frequent!.count).toBe(1);
    expect(by.prospect!.count).toBe(0);
  });

  it('never calls a migrated-only guest "recent" — the export carried no dates', async () => {
    const { segments } = await new MarketingService(repoWith(MIGRATED), darkLlm).getSegments();
    const by = Object.fromEntries(segments.map((s) => [s.key, s]));
    expect(by.past!.count).toBe(1);
    expect(by.past!.label).toBe('Past guest');
    expect(by.recent!.count).toBe(0);
  });

  it('summarises spend and lists top members per segment', async () => {
    const { segments } = await new MarketingService(repoWith(ROWS), darkLlm).getSegments();
    const vip = segments.find((s) => s.key === 'vip')!;
    expect(vip.total_spend).toBe(3_000_000);
    expect(vip.avg_spend).toBe(1_500_000);
    expect(vip.sample_names).toEqual(['Kagiso Holdings', 'Frequent Flyer']); // ordered by spend
  });
});

describe('MarketingService — segment members', () => {
  const withPhones: CustomerStat[] = [
    { id: 'a', name: 'University of Pennsylvania', email: null, phone: '77135784', company: null, stays: 0, previous_stays: 100, spend: 0, last_stay_days: null },
    { id: 'b', name: 'Big Spender', email: 'big@example.com', phone: '+267 71 000 000', company: 'Acme', stays: 1, previous_stays: 0, spend: 5_000_000, last_stay_days: 5 },
    { id: 'c', name: 'Not A VIP', email: null, phone: '+267 72 000 000', company: null, stays: 1, previous_stays: 0, spend: 100, last_stay_days: 5 },
  ];

  it('lists who is in the segment with the details needed to call them', async () => {
    const res = await new MarketingService(repoWith(withPhones), darkLlm).getSegmentMembers('vip');
    expect(res.total).toBe(2);
    expect(res.label).toBe('VIP');
    expect(res.members.map((m) => m.name)).toEqual(['University of Pennsylvania', 'Big Spender']);
    expect(res.members[0]!.phone).toBe('77135784');
    expect(res.members[0]!.total_stays).toBe(100);
  });

  it('ranks by stays before spend, so migrated accounts are not buried', async () => {
    // UPenn has 100 stays and zero recorded spend; Big Spender has P50,000 and one stay.
    const res = await new MarketingService(repoWith(withPhones), darkLlm).getSegmentMembers('vip');
    expect(res.members[0]!.spend).toBe(0);
    expect(res.members[1]!.spend).toBe(5_000_000);
  });

  it('searches across name, company, phone and email', async () => {
    const svc = new MarketingService(repoWith(withPhones), darkLlm);
    expect((await svc.getSegmentMembers('vip', { search: 'acme' })).members).toHaveLength(1);
    expect((await svc.getSegmentMembers('vip', { search: '77135' })).members).toHaveLength(1);
    expect((await svc.getSegmentMembers('vip', { search: 'nobody' })).members).toHaveLength(0);
  });

  it('caps the list and says so, rather than silently returning fewer', async () => {
    const res = await new MarketingService(repoWith(withPhones), darkLlm).getSegmentMembers('vip', { limit: 1 });
    expect(res.members).toHaveLength(1);
    expect(res.total).toBe(2);
    expect(res.truncated).toBe(true);
  });
});

describe('MarketingService — campaign (LLM-gated)', () => {
  it('returns null copy and never calls the API when the LLM is dark', async () => {
    const res = await new MarketingService(repoWith(ROWS), darkLlm).generateCampaign({ segment: 'vip', channel: 'email' });
    expect(res).toMatchObject({ configured: false, segment: 'vip', channel: 'email', copy: null });
    expect(darkLlm.generateText).not.toHaveBeenCalled();
  });

  it('generates copy from a segment-aware prompt when configured', async () => {
    const llm = liveLlm('SUBJECT: Welcome back');
    const res = await new MarketingService(repoWith(ROWS), llm).generateCampaign({ segment: 'vip', channel: 'email', goal: 'promote the festive season' });
    expect(res).toMatchObject({ configured: true, copy: 'SUBJECT: Welcome back' });
    const prompt = (llm.generateText as ReturnType<typeof vi.fn>).mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('VIP');
    expect(prompt).toContain('email');
    expect(prompt).toContain('festive season');
  });
});

describe('MarketingService — strategy (LLM-gated)', () => {
  it('echoes the dashboard metrics but yields null recommendations when dark', async () => {
    const res = await new MarketingService(repoWith(ROWS), darkLlm).getStrategy(REPORTS);
    expect(res.configured).toBe(false);
    expect(res.recommendations).toBeNull();
    expect(res.metrics.occupancy_pct).toBe(33.3);
    expect(res.metrics.properties[0]).toMatchObject({ name: 'Village', occupancy_pct: 35 });
  });

  it('feeds the metrics into the prompt and returns a brief when configured', async () => {
    const llm = liveLlm('1. Do the thing');
    const res = await new MarketingService(repoWith(ROWS), llm).getStrategy(REPORTS);
    expect(res).toMatchObject({ configured: true, recommendations: '1. Do the thing' });
    const prompt = (llm.generateText as ReturnType<typeof vi.fn>).mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('Occupancy 33.3%');
    expect(prompt).toContain('Village');
  });
});
