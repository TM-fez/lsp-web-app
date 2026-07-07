import { z } from 'zod';

// AI target marketing + strategy engine (P4.4). Two LLM-backed features that share
// the one Claude client (core/llm): (1) segment the guest base and draft a targeted
// campaign for a segment, (2) turn the estate dashboard into a strategy brief.
//
// Both stay DARK until ANTHROPIC_API_KEY is set: the deterministic segmentation
// always works, but the generated copy/brief is null with `configured: false` until
// the key lands — no request ever hits the API unconfigured.

// Mutually-exclusive segments, assigned by priority (see marketing.service).
export const SEGMENT_KEYS = ['vip', 'frequent', 'recent', 'lapsed', 'prospect'] as const;
export type SegmentKey = (typeof SEGMENT_KEYS)[number];

export const CampaignChannelEnum = z.enum(['email', 'whatsapp', 'sms']);
export type CampaignChannel = z.infer<typeof CampaignChannelEnum>;

export const GenerateCampaignSchema = z.object({
  segment: z.enum(SEGMENT_KEYS),
  channel: CampaignChannelEnum.default('email'),
  // An optional free-text nudge for the campaign's angle (a promo, an event, a season).
  goal: z.string().max(300).trim().optional(),
});
export type GenerateCampaignDTO = z.infer<typeof GenerateCampaignSchema>;

// One row of the deterministic segmentation.
export interface SegmentSummary {
  key: SegmentKey;
  label: string;
  description: string;
  count: number;
  total_spend: number;   // thebe (recognised/paid)
  avg_spend: number;     // thebe
  sample_names: string[];  // a few example guests (top by spend), for context
}

export interface SegmentsResponse {
  configured: boolean;         // is the LLM keyed? (drives the UI's dark-state banner)
  total_customers: number;
  segments: SegmentSummary[];
}

export interface CampaignResponse {
  configured: boolean;
  segment: SegmentKey;
  channel: CampaignChannel;
  copy: string | null;         // null when the LLM is dark
}

export interface StrategyResponse {
  configured: boolean;
  // The dashboard figures the brief was based on — echoed so the UI shows the inputs.
  metrics: {
    from: string;
    to: string;
    occupancy_pct: number;
    revenue: number;   // thebe
    net: number;       // thebe
    margin_pct: number;
    properties: Array<{ name: string; occupancy_pct: number | null; revenue: number }>;
  };
  recommendations: string | null;  // null when the LLM is dark
}
