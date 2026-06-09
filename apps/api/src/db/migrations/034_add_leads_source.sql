-- CRM follow-up — Lead source/channel for enquiry attribution.
-- The discovery review flagged that enquiries are not attributed ("how do you
-- know marketing worked? bookings happen"). This adds leads.source so each
-- enquiry can be tagged by channel (WhatsApp, walk-in, Booking.com, website,
-- referral, corporate, other). Nullable — existing leads have no recorded source.

ALTER TABLE leads ADD COLUMN source text;
