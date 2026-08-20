import { useQuery, useMutation } from '@tanstack/react-query';
import {
  getSegments, listSegmentMembers, generateCampaign, getStrategy, type CampaignInput,
} from '@/lib/api/marketing';
import type {
  SegmentsResponse, SegmentMembersResponse, CampaignResponse, StrategyResponse, SegmentKey,
} from '@/types';

/** Cheap, deterministic — auto-loads. */
export function useSegments() {
  return useQuery<SegmentsResponse>({ queryKey: ['marketing', 'segments'], queryFn: getSegments });
}

/** The guests in one segment. Only fetched once a segment is actually opened. */
export function useSegmentMembers(key: SegmentKey | null, search?: string) {
  return useQuery<SegmentMembersResponse>({
    queryKey: ['marketing', 'segment-members', key, search ?? ''],
    // The server's ceiling. 'Past guest' holds ~1,200 people, so the default cap of 500 would
    // hide most of a segment — and its CSV would ship short without saying so.
    queryFn: () => listSegmentMembers(key!, { search: search?.trim() || undefined, limit: 2000 }),
    enabled: key !== null,
  });
}

/** On-demand (costs tokens) — fires only on the button press. */
export function useGenerateCampaign() {
  return useMutation<CampaignResponse, Error, CampaignInput>({ mutationFn: generateCampaign });
}

/** On-demand (costs tokens) — fires only on the button press. */
export function useStrategy() {
  return useMutation<StrategyResponse, Error, void>({ mutationFn: () => getStrategy() });
}
