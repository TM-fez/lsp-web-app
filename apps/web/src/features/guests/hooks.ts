import {
  useInfiniteQuery, useMutation, useQueryClient, keepPreviousData,
} from '@tanstack/react-query';
import {
  listGuests,
  GUEST_LIST_LIMIT,
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

/**
 * The directory a page at a time. The server caps a page at 100 rows and the estate now holds
 * ~1,300 guests, so a single fetch showed the first 100 and silently hid the rest — including,
 * after a sort by stay history, most of the accounts worth seeing. Pages accumulate behind a
 * "Load more" button rather than auto-loading: 14 requests on mount would be worse.
 */
export function useGuests(params: GuestListParams) {
  return useInfiniteQuery({
    queryKey: [...GUESTS_KEY, params],
    queryFn: ({ pageParam }) => listGuests(params, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last: Paginated<Contact>, pages) =>
      pages.length * GUEST_LIST_LIMIT < last.total ? pages.length + 1 : undefined,
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
