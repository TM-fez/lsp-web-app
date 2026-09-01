import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReservationsService, isReservationOverlapError } from '../../../src/modules/reservations/reservations.service';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository';

describe('ReservationsService', () => {
  let service: ReservationsService;
  let repository: vi.Mocked<ReservationsRepository>;

  beforeEach(() => {
    repository = {
      findById: vi.fn(),
      findPaginated: vi.fn(),
      checkAvailability: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      contactExists: vi.fn(),
    } as unknown as vi.Mocked<ReservationsRepository>;

    service = new ReservationsService(repository);
  });

  describe('createReservation', () => {
    it('should throw if check-in date is in the past', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const dto = { 
        contact_id: 'c1', room_id: 'r1', 
        check_in_date: pastDate, 
        check_out_date: new Date() 
      };
      
      await expect(service.createReservation(dto as any, {} as any))
        .rejects.toThrow('Cannot create reservation with check-in date in the past');
    });

    it('should throw if room is not available', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      
      repository.checkAvailability.mockResolvedValue(false);

      const dto = { 
        contact_id: 'c1', room_id: 'r1', 
        check_in_date: tomorrow, 
        check_out_date: nextWeek 
      };

      await expect(service.createReservation(dto as any, {} as any))
        .rejects.toThrow('Room is not available for the selected dates');
    });

    it('should create if validations pass', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      
      repository.checkAvailability.mockResolvedValue(true);
      repository.create.mockResolvedValue({ id: 'res1' } as any);

      const dto = { 
        contact_id: 'c1', room_id: 'r1', 
        check_in_date: tomorrow, 
        check_out_date: nextWeek 
      };

      const meta = { userId: 'u1', ip: '127.0.0.1', requestId: 'req1' };
      const res = await service.createReservation(dto as any, meta);
      
      expect(res.id).toBe('res1');
      expect(repository.create).toHaveBeenCalled();
    });

    it('forces new reservations to PENDING even when a client supplies CONFIRMED', async () => {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
      repository.checkAvailability.mockResolvedValue(true);
      repository.create.mockResolvedValue({ id: 'res1', status: 'PENDING' } as any);

      const dto = { contact_id: 'c1', room_id: 'r1', check_in_date: tomorrow, check_out_date: nextWeek, status: 'CONFIRMED' };
      await service.createReservation(dto as any, { userId: 'u1' } as any);

      const passed = (repository.create as any).mock.calls[0][0];
      expect(passed.status).toBe('PENDING'); // only settlePaid() may confirm
    });

    it('rejects a bogus CRM contact with a clean 400 (coordinator + billing checked)', async () => {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
      repository.contactExists.mockResolvedValue(false);

      const base = { contact_id: 'c1', room_id: 'r1', check_in_date: tomorrow, check_out_date: nextWeek };
      await expect(
        service.createReservation({ ...base, booking_coordinator_id: 'ghost' } as any, { userId: 'u1' } as any),
      ).rejects.toThrow('Booking coordinator must be an existing contact');
      await expect(
        service.createReservation({ ...base, billing_contact_id: 'ghost' } as any, { userId: 'u1' } as any),
      ).rejects.toThrow('Billing contact must be an existing contact');
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('accepts valid CRM contacts and passes them through to the insert', async () => {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
      repository.contactExists.mockResolvedValue(true);
      repository.checkAvailability.mockResolvedValue(true);
      repository.create.mockResolvedValue({ id: 'res1' } as any);

      const dto = {
        contact_id: 'c1', room_id: 'r1', check_in_date: tomorrow, check_out_date: nextWeek,
        booking_coordinator_id: 'coord1', billing_contact_id: 'bill1',
      };
      await service.createReservation(dto as any, { userId: 'u1' } as any);

      const passed = (repository.create as any).mock.calls[0][0];
      expect(passed.booking_coordinator_id).toBe('coord1');
      expect(passed.billing_contact_id).toBe('bill1');
    });

    it('translates the DB overlap constraint (a race) into a 409 conflict', async () => {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
      repository.checkAvailability.mockResolvedValue(true); // passes the pre-check…
      // …but another booking raced in; the DB exclusion constraint rejects the insert.
      repository.create.mockRejectedValue({ code: '23P01', constraint: 'reservations_no_overlap' });
      const dto = { contact_id: 'c1', room_id: 'r1', check_in_date: tomorrow, check_out_date: nextWeek };
      await expect(service.createReservation(dto as any, { userId: 'u1' } as any))
        .rejects.toThrow('Room is not available for the selected dates');
    });
  });

  describe('modifyReservation — commercial invariant', () => {
    it('rejects a direct edit to CONFIRMED (only settlePaid may confirm)', async () => {
      repository.findById.mockResolvedValue({ id: 'res1', status: 'PENDING' } as any);
      await expect(
        service.modifyReservation('res1', { status: 'CONFIRMED' } as any, { userId: 'u1' } as any),
      ).rejects.toThrow(/set by the system/i);
    });

    it('rejects a direct edit to CHECKED_IN', async () => {
      repository.findById.mockResolvedValue({ id: 'res1', status: 'CONFIRMED' } as any);
      await expect(
        service.modifyReservation('res1', { status: 'CHECKED_IN' } as any, { userId: 'u1' } as any),
      ).rejects.toThrow(/set by the system/i);
    });
  });

  describe('claimOtaBooking — Tier 1 OTA contact capture', () => {
    const block = { id: 'res-b', status: 'BLOCKED', source: 'BOOKING_COM' };

    it('attaches the contact and promotes the block to CONFIRMED', async () => {
      repository.findById.mockResolvedValue(block as any);
      repository.contactExists.mockResolvedValue(true);
      repository.update.mockResolvedValue({ ...block, status: 'CONFIRMED', contact_id: 'c9' } as any);

      const res = await service.claimOtaBooking('res-b', { contact_id: 'c9' }, { userId: 'u1' } as any);

      expect(res.status).toBe('CONFIRMED');
      expect(repository.update).toHaveBeenCalledWith(
        'res-b',
        expect.objectContaining({ contact_id: 'c9', status: 'CONFIRMED' }),
        expect.anything(),
      );
    });

    it('refuses anything that is not an unclaimed Booking.com block', async () => {
      repository.findById.mockResolvedValue({ ...block, status: 'CONFIRMED' } as any);
      await expect(
        service.claimOtaBooking('res-b', { contact_id: 'c9' }, { userId: 'u1' } as any),
      ).rejects.toThrow('Only an unclaimed Booking.com block can be claimed');

      repository.findById.mockResolvedValue({ ...block, source: 'DIRECT' } as any);
      await expect(
        service.claimOtaBooking('res-b', { contact_id: 'c9' }, { userId: 'u1' } as any),
      ).rejects.toThrow('Only an unclaimed Booking.com block can be claimed');
    });

    it('refuses a contact that does not exist', async () => {
      repository.findById.mockResolvedValue(block as any);
      repository.contactExists.mockResolvedValue(false);
      await expect(
        service.claimOtaBooking('res-b', { contact_id: 'ghost' }, { userId: 'u1' } as any),
      ).rejects.toThrow('Contact not found');
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('markPaid', () => {
    const pending = {
      id: 'res-w',
      status: 'PENDING',
      source: 'WEBSITE',
      room_id: 'room-1',
      check_in_date: new Date('2026-09-01'),
      check_out_date: new Date('2026-09-03'),
      discount_type: null,
      discount_value: null,
      discount_reason: null,
      discount_approved_at: null,
    };

    // The priced stay the service should charge: 2 nights, 10% discount applied,
    // 12% tax on the discounted subtotal. total_amount is what must be paid.
    const priced = {
      priceable: true as const,
      currency: 'BWP',
      nights: 2,
      base_amount: 100_000,
      discount: { type: 'PERCENT' as const, value: 10, reason: null, approved: true, amount: 10_000 },
      subtotal: 90_000,
      tax_rate_bps: 1200,
      tax_amount: 10_800,
      total_amount: 100_800,
      deposit_pct: 0,
      deposit_amount: 0,
    };

    let rooms: any, pricing: any, quotes: any, holds: any, payments: any, invoices: any, paid: ReservationsService;

    beforeEach(() => {
      rooms = { findById: vi.fn().mockResolvedValue({ id: 'room-1', type: 'STANDARD' }) };
      pricing = { getActivePlan: vi.fn(), priceStay: vi.fn() };
      quotes = { createQuote: vi.fn().mockResolvedValue({ id: 'q1', total_amount: 100_800, deposit_amount: 0 }) };
      holds = { createHold: vi.fn().mockResolvedValue({ id: 'h1' }) };
      payments = {
        createIntent: vi.fn().mockResolvedValue({ id: 'pi1' }),
        attempt: vi.fn().mockResolvedValue({ id: 'pi1', status: 'PAID' }),
      };
      invoices = {
        issueSettledInvoice: vi.fn().mockResolvedValue({ id: 'inv1', status: 'PAID' }),
        issueInvoice: vi.fn().mockResolvedValue({ id: 'inv2', status: 'ISSUED' }),
      };
      paid = new ReservationsService(repository, rooms, pricing, quotes, holds, payments, invoices);
      // priceReservation is exercised by its own tests; stub it so these focus on the chain.
      vi.spyOn(paid, 'priceReservation').mockResolvedValue(priced as any);
      repository.findById.mockResolvedValue(pending as any);
    });

    it('drives quote → hold → intent → successful attempt, in that order', async () => {
      await paid.markPaid('res-w', { method: 'CASH' } as any, { userId: 'u1' } as any);

      expect(quotes.createQuote).toHaveBeenCalledWith(
        expect.objectContaining({ unit_type: 'STANDARD', check_in: pending.check_in_date }),
        expect.anything(),
      );
      expect(holds.createHold).toHaveBeenCalledWith(
        expect.objectContaining({ quote_id: 'q1', reservation_id: 'res-w' }),
        expect.anything(),
      );
      expect(payments.createIntent).toHaveBeenCalledWith(
        expect.objectContaining({ hold_id: 'h1', method: 'CASH' }),
        expect.anything(),
      );
      expect(payments.attempt).toHaveBeenCalledWith(
        'pi1',
        expect.objectContaining({ outcome: 'SUCCESS' }),
        expect.anything(),
      );
    });

    it('charges the discounted total, not the pre-discount price', async () => {
      await paid.markPaid('res-w', { method: 'EFT', reference: 'FNB-123' } as any, { userId: 'u1' } as any);

      expect(payments.createIntent).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100_800 }),
        expect.anything(),
      );
      expect(payments.attempt).toHaveBeenCalledWith(
        'pi1',
        expect.objectContaining({ reference: 'FNB-123' }),
        expect.anything(),
      );
    });

    it('honours an explicit part payment and labels it a deposit', async () => {
      await paid.markPaid('res-w', { method: 'CASH', amount: 50_000 } as any, { userId: 'u1' } as any);
      expect(payments.createIntent).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 50_000, purpose: 'DEPOSIT' }),
        expect.anything(),
      );
    });

    it('refuses to take more than the booking is worth', async () => {
      await expect(
        paid.markPaid('res-w', { method: 'CASH', amount: 999_999 } as any, { userId: 'u1' } as any),
      ).rejects.toThrow('cannot be more than the total due');
      expect(quotes.createQuote).not.toHaveBeenCalled();
    });

    it('refuses anything that is not still pending', async () => {
      repository.findById.mockResolvedValue({ ...pending, status: 'CONFIRMED' } as any);
      await expect(
        paid.markPaid('res-w', { method: 'CASH' } as any, { userId: 'u1' } as any),
      ).rejects.toThrow('Only a pending booking can be marked paid');
      expect(payments.attempt).not.toHaveBeenCalled();
    });

    it('refuses when the stay cannot be priced', async () => {
      vi.spyOn(paid, 'priceReservation').mockResolvedValue({
        priceable: false,
        reason: 'No active rate plan for a STANDARD unit',
        nights: 2,
      } as any);
      await expect(
        paid.markPaid('res-w', { method: 'CASH' } as any, { userId: 'u1' } as any),
      ).rejects.toThrow('cannot be priced');
      expect(quotes.createQuote).not.toHaveBeenCalled();
    });

    it('fails loudly rather than half-charging when the money loop is not wired', async () => {
      const bare = new ReservationsService(repository);
      await expect(
        bare.markPaid('res-w', { method: 'CASH' } as any, { userId: 'u1' } as any),
      ).rejects.toThrow('Payment recording is not configured');
    });

    // The whole point of recording the payment here: Accounts gets a document out of
    // it. Before this, a settled booking left no invoice at all and the Finance
    // screens stayed empty.
    it('raises a paid-up receipt for the amount actually taken', async () => {
      await paid.markPaid('res-w', { method: 'CASH' } as any, { userId: 'u1' } as any);

      expect(invoices.issueSettledInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          quote_id: 'q1',
          hold_id: 'h1',
          reservation_id: 'res-w',   // attributable: the list can name the guest
          kind: 'BALANCE',           // paid in full
          amount: 100_800,           // the discounted total, not the list price
        }),
        expect.anything(),
      );
    });

    it('labels a part payment as a deposit on the receipt too', async () => {
      await paid.markPaid('res-w', { method: 'CASH', amount: 50_000 } as any, { userId: 'u1' } as any);
      expect(invoices.issueSettledInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'DEPOSIT', amount: 50_000 }),
        expect.anything(),
      );
    });

    // Without the second invoice the unpaid remainder is invisible: no open invoice
    // means nothing in the Finance cockpit's total, its ageing, or receivables.
    it('invoices the remainder as UNPAID when only part is handed over', async () => {
      await paid.markPaid('res-w', { method: 'CASH', amount: 50_000 } as any, { userId: 'u1' } as any);

      expect(invoices.issueInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'BALANCE',
          amount: 50_800,              // 100_800 due − 50_000 taken
          reservation_id: 'res-w',     // attributable, so it lands on the right property
        }),
        expect.anything(),
      );
    });

    it('raises no second invoice when the booking is paid in full', async () => {
      await paid.markPaid('res-w', { method: 'CASH' } as any, { userId: 'u1' } as any);
      expect(invoices.issueSettledInvoice).toHaveBeenCalledTimes(1);
      expect(invoices.issueInvoice).not.toHaveBeenCalled();
    });

    // Money has already changed hands and the booking is CONFIRMED by this point.
    // Telling reception "payment failed" because a DOCUMENT could not be written
    // would send the guest round to pay a second time.
    it('still confirms the booking when the receipt cannot be raised', async () => {
      invoices.issueSettledInvoice.mockRejectedValue(new Error('invoice numbering collision'));
      repository.findById.mockResolvedValue(pending as any);

      await expect(
        paid.markPaid('res-w', { method: 'CASH' } as any, { userId: 'u1' } as any),
      ).resolves.toBeDefined();

      expect(payments.attempt).toHaveBeenCalledWith(
        'pi1',
        expect.objectContaining({ outcome: 'SUCCESS' }),
        expect.anything(),
      );
    });
  });

  describe('markNoShow', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dueYesterday = {
      id: 'res-n', status: 'CONFIRMED', source: 'WALK_IN', room_id: 'room-1',
      check_in_date: yesterday, check_out_date: tomorrow,
    };

    it('marks a confirmed booking whose arrival day has passed', async () => {
      repository.findById.mockResolvedValue(dueYesterday as any);
      repository.update.mockResolvedValue({ ...dueYesterday, status: 'NO_SHOW' } as any);

      const out = await service.markNoShow('res-n', { userId: 'u1' } as any);

      expect(out.status).toBe('NO_SHOW');
      expect(repository.update).toHaveBeenCalledWith(
        'res-n',
        expect.objectContaining({ status: 'NO_SHOW' }),
        expect.anything(),
      );
    });

    // Marking someone a no-show on the morning they are due is a mistake, not a call.
    it('refuses a guest who is not due until today or later', async () => {
      repository.findById.mockResolvedValue({ ...dueYesterday, check_in_date: tomorrow } as any);
      await expect(
        service.markNoShow('res-n', { userId: 'u1' } as any),
      ).rejects.toThrow('not due to arrive until today or later');
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('refuses anything that is not confirmed', async () => {
      repository.findById.mockResolvedValue({ ...dueYesterday, status: 'CHECKED_IN' } as any);
      await expect(
        service.markNoShow('res-n', { userId: 'u1' } as any),
      ).rejects.toThrow('Only a confirmed booking can be marked a no-show');
    });
  });

  describe('isReservationOverlapError', () => {
    it('matches the no-overlap exclusion violation', () => {
      expect(isReservationOverlapError({ code: '23P01', constraint: 'reservations_no_overlap' })).toBe(true);
    });
    it('ignores other errors', () => {
      expect(isReservationOverlapError({ code: '23505', constraint: 'reservations_no_overlap' })).toBe(false);
      expect(isReservationOverlapError({ code: '23P01', constraint: 'other' })).toBe(false);
      expect(isReservationOverlapError(new Error('nope'))).toBe(false);
      expect(isReservationOverlapError(null)).toBe(false);
    });
  });
});
