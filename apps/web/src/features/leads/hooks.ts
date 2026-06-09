import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  listLeads,
  createLead,
  updateLead,
  deleteLead,
  type LeadListParams,
  type CreateLeadInput,
  type UpdateLeadInput,
} from '@/lib/api/leads';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { Lead, Paginated } from '@/types';

const LEADS_KEY = ['leads'] as const;

export function useLeads(params: LeadListParams) {
  return useQuery<Paginated<Lead>>({
    queryKey: [...LEADS_KEY, params],
    queryFn: () => listLeads(params),
    placeholderData: keepPreviousData,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: LEADS_KEY });
}

export function useCreateLead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateLeadInput) => createLead(input),
    onSuccess: () => {
      toast.success('Enquiry logged');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useUpdateLead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateLeadInput }) => updateLead(id, input),
    onSuccess: () => {
      toast.success('Enquiry updated');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useDeleteLead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteLead(id),
    onSuccess: () => {
      toast.success('Enquiry removed');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}
