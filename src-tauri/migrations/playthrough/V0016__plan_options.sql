-- Per-plan solver options. `include_sam` gates recipes whose chain
-- needs SAM: off by default, flipped from the designer header, and
-- forced on (UI-disabled) when a target can only be made with SAM.
CREATE TABLE IF NOT EXISTS factory_plan_option (
    factory_id  TEXT PRIMARY KEY NOT NULL REFERENCES factory(id) ON DELETE CASCADE,
    include_sam INTEGER NOT NULL DEFAULT 0 CHECK (include_sam IN (0, 1)),
    updated_at  TEXT NOT NULL
);
