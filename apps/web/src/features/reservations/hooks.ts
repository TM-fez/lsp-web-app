import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  listReservations,
  createReservation,
  updateReservation,
  claimOtaBooking,
  cancelReservation,
  removeReservation,
  checkAvailability,
  setDiscount,
  approveDiscount,
  removeDiscount,
  getReservationPricing,
  markReservationPaid,
  markReservationNoShow,
  type ReservationListParams,
  type CreateReservationInput,
  type UpdateReservationInput,
  type SetDiscountInput,
  type MarkPaidInput,
  type ReservationPricing,
  type ReservationNotPriceable,
} from '@/lib/api/reservations';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { Paginated, Reservation } from '@/types';

const RES_KEY = ['reservations'] as const;

export function useReservations(params: ReservationListParams) {
  return useQuery<Paginated<Reservation>>({
    queryKey: [...RES_KEY, params],
    queryFn: () => listReservations(params),
    placeholderData: keepPreviousData,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: RES_KEY });
}

export function useCreateReservation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateReservationInput) => createReservation(input),
    onSuccess: () => {
      toast.success('Reservation created — pending payment');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useUpdateReservation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateReservationInput }) => updateReservation(id, input),
    onSuccess: () => {
      toast.success('Reservation updated');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useClaimOtaBooking() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, contactId }: { id: string; contactId: string }) => claimOtaBooking(id, contactId),
    onSuccess: () => {
      toast.success('Booking claimed — the guest is now on the arrivals list');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useCancelReservation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => cancelReservation(id),
    onSuccess: () => {
      toast.success('Reservation cancelled');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useRemoveReservation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => removeReservation(id),
    onSuccess: () => {
      toast.success('Reservation removed');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

/**
 * Record a payment against a pending booking. On success the server has run the
 * full money loop (quote → hold → intent → settlePaid), so the booking comes back
 * CONFIRMED — invalidating RES_KEY refreshes the row, its badge and its pricing.
 */
export function useMarkPaid() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MarkPaidInput }) => markReservationPaid(id, input),
    onSuccess: () => {
      toast.success('Payment recorded — booking confirmed ✓');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

/**
 * Mark a confirmed booking a no-show. Invalidating RES_KEY refreshes the row and its
 * badge; the cockpit board drops it from Arrivals on its own next poll, since that
 * query asks for CONFIRMED.
 */
export function useMarkNoShow() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => markReservationNoShow(id),
    onSuccess: () => {
      toast.success('Recorded as a no-show — the nights are free again');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useSetDiscount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SetDiscountInput }) => setDiscount(id, input),
    onSuccess: () => {
      toast.success('Discount applied');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useApproveDiscount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => approveDiscount(id),
    onSuccess: () => {
      toast.success('Discount approved ✓');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useRemoveDiscount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => removeDiscount(id),
    onSuccess: () => {
      toast.success('Discount removed');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

/**
 * Amount-due breakdown for a booking (stay price + applied discount). Keyed under
 * RES_KEY so the discount mutations' invalidation also refreshes it — approve a
 * discount and the amount due updates without a manual refetch.
 */
export function useReservationPricing(id: string | undefined, enabled: boolean) {
  return useQuery<ReservationPricing | ReservationNotPriceable>({
    queryKey: [...RES_KEY, 'pricing', id],
    queryFn: () => getReservationPricing(id as string),
    enabled: enabled && !!id,
  });
}

/** Live availability check for the create flow (server excludes self on edit). */
export function useAvailability(
  params: { room_id: string; check_in_date: string; check_out_date: string },
  enabled: boolean,
) {
  return useQuery<boolean>({
    queryKey: ['availability', params],
    queryFn: () => checkAvailability(params),
    enabled,
  });
}
