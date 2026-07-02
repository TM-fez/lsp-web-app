-- Phase 3 (A3): compliance checklists with turnaround tracking.
--
-- The checklist is the company's cleaning standard: a manager-maintained list
-- of items every turn must satisfy. A cleaner ticks items off while the unit
-- is CLEANING; supervisor validation (inspect) is BLOCKED until every active
-- item is ticked — that is the compliance gate. Ticks live per task, so a
-- finished turn keeps its full compliance record (who ticked what, when).
--
-- Turnaround tracking needs no new columns — opened_at → completed_at already
-- brackets the turn; a new endpoint aggregates it per property.

-- The standard. Global (company-wide), like payroll; per-property standards can
-- come later if a second operator model ever appears.
CREATE TABLE housekeeping_checklist_items (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  label      VARCHAR(200) NOT NULL,
  sort_order INTEGER      NOT NULL DEFAULT 0,
  active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by UUID         REFERENCES users(id),
  updated_by UUID         REFERENCES users(id),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One tick per item per task. Unticking deletes the row.
CREATE TABLE housekeeping_task_checks (
  task_id    UUID        NOT NULL REFERENCES housekeeping_tasks(id) ON DELETE CASCADE,
  item_id    UUID        NOT NULL REFERENCES housekeeping_checklist_items(id) ON DELETE CASCADE,
  checked_by UUID        NOT NULL REFERENCES users(id),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, item_id)
);

-- A sensible default standard so the gate means something on day one; the
-- manager edits it from the housekeeping screen.
INSERT INTO housekeeping_checklist_items (label, sort_order) VALUES
  ('Bathroom cleaned and sanitised',        1),
  ('Bed linen and towels changed',          2),
  ('Floors vacuumed and mopped',            3),
  ('Surfaces dusted and wiped',             4),
  ('Kitchen/kitchenette cleaned',           5),
  ('Bins emptied and liners replaced',      6),
  ('Amenities restocked',                   7),
  ('Damage or maintenance issues reported', 8);
