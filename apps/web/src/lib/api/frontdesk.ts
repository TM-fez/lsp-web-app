import { api } from './client';

export async function checkIn(reservationId: string, guestCount = 1): Promise<void> {
  await api.post('/checkins', { reservation_id: reservationId, guest_count: guestCount });
}

export async function checkOut(occupancyId: string): Promise<void> {
  await api.post(`/checkins/${occupancyId}/checkout`, {});
}
