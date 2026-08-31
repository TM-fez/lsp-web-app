-- Reception may confirm a payment, not merely start one.
--
-- Migration 031 granted reception `payments.create` but not `payments.update`, and
-- POST /payments/:id/attempt — the call that records whether the money actually
-- arrived — authorizes on `payments.update`. The result was a front desk that could
-- raise a payment intent and never settle it: the guest pays cash at reception, and
-- the booking stays PENDING until an admin or Accounts logs in to finish the job.
-- The same gap silently hid the new Mark-paid button on a booking, which exists for
-- exactly this scenario.
--
-- 031's own comment describes the role as "front desk — quote, hold, take payments,
-- read invoices", so the grant, not the intent, was the thing that was wrong.
--
-- Owner decision (2026-08-31): reception confirms payments. A 25-unit operation
-- cannot route every desk payment through a second person. The audit trail is the
-- control instead of the permission — settlePaid() already records who settled what
-- against the intent, the hold and the reservation, in the same transaction.
--
-- Deliberately NOT granted: invoices.create / invoices.update. The receipt raised by
-- markPaid() is written by the service inside the request, not by a call the user
-- makes to the invoices API, so reception needs no invoice-writing rights to get one.

INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name = 'payments.update'
  WHERE r.name = 'reception'
ON CONFLICT DO NOTHING;
