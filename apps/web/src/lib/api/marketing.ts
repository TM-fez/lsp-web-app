import { api } from './client';
import type { SegmentsResponse, CampaignResponse, StrategyResponse, SegmentKey, CampaignChannel } from '@/types';

/** P4.4 — deterministic guest segments (+ whether the LLM is keyed). */
export async function getSegments(): Promise<SegmentsResponse> {
  const { data } = await api.get<SegmentsResponse>('/marketing/segments');
  return data;
}

export interface CampaignInput {
  segment: SegmentKey;
  channel: CampaignChannel;
  goal?: string;
}

/** Draft campaign copy for a segment (LLM-gated server-side). */
export async function generateCampaign(input: CampaignInput): Promise<CampaignResponse> {
  const { data } = await api.post<CampaignResponse>('/marketing/campaign', input);
  return data;
}

/** A strategy brief from the estate dashboard (LLM-gated server-side). */
export async function getStrategy(): Promise<StrategyResponse> {
  const { data } = await api.get<StrategyResponse>('/marketing/strategy');
  return data;
}
