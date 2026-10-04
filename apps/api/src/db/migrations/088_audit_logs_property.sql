-- (R5 retest) The activity feed knows each row's property up front.
--
-- Round 4 made the feed read the newest audit rows in chunks and work out each row's
-- property on the fly (a correlated lookup per row). For a user limited to CBD while the
-- Village is busy, that still meant resolving ~8,000 Village rows (~180 ms at 100k rows) —
-- and once that cap was reached the feed came back EMPTY even though older CBD changes
-- existed. The fix is to resolve the property once, when the row is written, and index it.
--
--  property_id  the property the change belongs to (NULL when it belongs to none)
--  scope_kind   'P' = belongs to `property_id`
--               'G' = belongs to no property (rate plans, staff, company costs…)
--               'C' = a guest: they belong to every property they have booked at, which
--                     can change, so the feed still works that out when it reads
--
-- Resolved at INSERT time by trigger, from the same rules the feed used (one function, so
-- the backfill and new rows agree). A change is filed under the property it happened in;
-- moving a booking to another property later does not move its history. That is the
-- honest reading of an audit trail, and it is what made the old feed's answer drift.

ALTER TABLE audit_logs
  ADD COLUMN property_id UUID,
  ADD COLUMN scope_kind  CHAR(1) NOT NULL DEFAULT 'G' CHECK (scope_kind IN ('P', 'G', 'C'));

CREATE OR REPLACE FUNCTION audit_property_of(p_entity TEXT, p_eid UUID) RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT CASE p_entity
    WHEN 'reservations' THEN
      (SELECT b.property_id FROM reservations r JOIN rooms rm ON rm.id = r.room_id
         JOIN buildings b ON b.id = rm.building_id WHERE r.id = p_eid)
    WHEN 'rooms' THEN
      (SELECT b.property_id FROM rooms rm JOIN buildings b ON b.id = rm.building_id WHERE rm.id = p_eid)
    WHEN 'channel_collision' THEN
      (SELECT b.property_id FROM rooms rm JOIN buildings b ON b.id = rm.building_id WHERE rm.id = p_eid)
    WHEN 'housekeeping_tasks' THEN
      (SELECT b.property_id FROM housekeeping_tasks t JOIN rooms rm ON rm.id = t.room_id
         JOIN buildings b ON b.id = rm.building_id WHERE t.id = p_eid)
    WHEN 'maintenance_work_orders' THEN
      (SELECT b.property_id FROM maintenance_work_orders w JOIN rooms rm ON rm.id = w.room_id
         JOIN buildings b ON b.id = rm.building_id WHERE w.id = p_eid)
    WHEN 'maintenance_expense' THEN
      (SELECT b.property_id FROM maintenance_work_orders w JOIN rooms rm ON rm.id = w.room_id
         JOIN buildings b ON b.id = rm.building_id WHERE w.id = p_eid)
    WHEN 'occupancy' THEN
      (SELECT b.property_id FROM occupancy o JOIN rooms rm ON rm.id = o.room_id
         JOIN buildings b ON b.id = rm.building_id WHERE o.id = p_eid)
    WHEN 'holds' THEN
      (SELECT b.property_id FROM holds h JOIN rooms rm ON rm.id = h.room_id
         JOIN buildings b ON b.id = rm.building_id WHERE h.id = p_eid)
    WHEN 'invoices' THEN
      (SELECT b.property_id FROM invoices i JOIN reservations r ON r.id = i.reservation_id
         JOIN rooms rm ON rm.id = r.room_id JOIN buildings b ON b.id = rm.building_id WHERE i.id = p_eid)
    WHEN 'payment_intents' THEN
      (SELECT b.property_id FROM payment_intents pi
         LEFT JOIN holds h ON h.id = pi.hold_id
         LEFT JOIN invoices pinv ON pinv.id = pi.invoice_id
         JOIN rooms rm ON rm.id = coalesce(
           h.room_id,
           (SELECT res.room_id FROM reservations res WHERE res.id = coalesce(h.reservation_id, pinv.reservation_id)))
         JOIN buildings b ON b.id = rm.building_id WHERE pi.id = p_eid)
    WHEN 'leads' THEN (SELECT l.property_id FROM leads l WHERE l.id = p_eid)
    WHEN 'buildings' THEN (SELECT bl.property_id FROM buildings bl WHERE bl.id = p_eid)
    WHEN 'properties' THEN p_eid
    WHEN 'operating_expense' THEN (SELECT oe.property_id FROM operating_expenses oe WHERE oe.id = p_eid)
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION audit_logs_set_property() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_eid UUID;
BEGIN
  IF NEW.entity_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    v_eid := NEW.entity_id::uuid;
  END IF;
  IF NEW.entity = 'contacts' THEN
    NEW.scope_kind := 'C';
    NEW.property_id := NULL;
  ELSE
    NEW.property_id := CASE WHEN v_eid IS NULL THEN NULL ELSE audit_property_of(NEW.entity, v_eid) END;
    NEW.scope_kind := CASE WHEN NEW.property_id IS NULL THEN 'G' ELSE 'P' END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_logs_set_property
  BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_set_property();

-- Backfill the history with the same rules.
UPDATE audit_logs SET scope_kind = 'C' WHERE entity = 'contacts';
UPDATE audit_logs a
   SET property_id = audit_property_of(a.entity, a.entity_id::uuid)
 WHERE a.entity <> 'contacts'
   AND a.entity_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
UPDATE audit_logs SET scope_kind = 'P' WHERE property_id IS NOT NULL;

-- One property's history, newest first; and everything that is not tied to one property.
CREATE INDEX audit_logs_property_created_idx ON audit_logs (property_id, created_at DESC, id DESC)
  WHERE scope_kind = 'P';
CREATE INDEX audit_logs_unscoped_created_idx ON audit_logs (created_at DESC, id DESC)
  WHERE scope_kind <> 'P';
