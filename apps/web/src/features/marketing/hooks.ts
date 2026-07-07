import { useQuery, useMutation } from '@tanstack/react-query';
import { getSegments, generateCampaign, getStrategy, type CampaignInput } from '@/lib/api/marketing';
import type { SegmentsResponse, CampaignResponse, StrategyResponse } from '@/types';

/** Cheap, deterministic — auto-loads. */
export function useSegments() {
  return useQuery<SegmentsResponse>({ queryKey: ['marketing', 'segments'], queryFn: getSegments });
}

/** On-demand (costs tokens) — fires only on the button press. */
export function useGenerateCampaign() {
  return useMutation<CampaignResponse, Error, CampaignInput>({ mutationFn: generateCampaign });
}

/** On-demand (costs tokens) — fires only on the button press. */
export function useStrategy() {
  return useMutation<StrategyResponse, Error, void>({ mutationFn: () => getStrategy() });
}
