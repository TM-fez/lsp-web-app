-- (Round 4, access and property scoping)
--
-- 1. Leads get a property (N-9). Until now an enquiry belonged to the whole house: any
--    user with crm.leads.read read every lead, and any user with crm.leads.update or
--    crm.leads.delete could change or remove another property's. The column is NULLABLE on
--    purpose — enquiries that arrive through the public website name no property — and a
--    NULL-property lead is then visible only to its creator and to people who can see every
--    property (see core/scope/propertyScope.ts).
--
-- 2. The /activity feed resolves each audit row's property at read time. To keep that fast
--    on a big audit_logs it now reads the newest rows in small chunks, which needs a
--    deterministic (created_at, id) order that an index can serve. The old index covered
--    created_at alone, so every chunk needed a sort step on ties.
--
-- Nothing is dropped. Safe to re-run.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id);

-- Backfill only what can be derived with certainty: a lead that became a booking sits in the
-- property of that booking's unit. Every other existing lead stays NULL (creator + every-
-- property users) rather than guessing.
UPDATE leads l
   SET property_id = b.property_id
  FROM reservations r
  JOIN rooms rm ON rm.id = r.room_id
  JOIN buildings b ON b.id = rm.building_id
 WHERE l.converted_reservation_id = r.id
   AND l.property_id IS NULL;

CREATE INDEX IF NOT EXISTS leads_property_idx ON leads (property_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS audit_logs_created_id_idx ON audit_logs (created_at DESC, id DESC);
