import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  listGuests,
  createGuest,
  updateGuest,
  deleteGuest,
  type GuestListParams,
  type CreateGuestInput,
  type UpdateGuestInput,
} from '@/lib/api/guests';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { Contact, Paginated } from '@/types';

const GUESTS_KEY = ['guests'] as const;

export function useGuests(params: GuestListParams) {
  return useQuery<Paginated<Contact>>({
    queryKey: [...GUESTS_KEY, params],
    queryFn: () => listGuests(params),
    // Keep the current rows visible while a new search/filter query loads.
    placeholderData: keepPreviousData,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: GUESTS_KEY });
}

export function useCreateGuest() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateGuestInput) => createGuest(input),
    onSuccess: () => {
      toast.success('Guest added');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useUpdateGuest() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateGuestInput }) => updateGuest(id, input),
    onSuccess: () => {
      toast.success('Guest updated');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useDeleteGuest() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteGuest(id),
    onSuccess: () => {
      toast.success('Guest removed');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}
