-- Phase 9: per-factory power generators. Each row records one bank of
-- identical generators on one factory burning a specific fuel at a
-- chosen clock. Output and fuel consumption come from the bundled
-- `Generator` row + the chosen `GeneratorFuel`; the slice's domain
-- math multiplies by `count × clock_pct/100`.
--
-- Numbered V0007 to leave room for V0005 (alts/somersloop, on the
-- parallel Phase 8 branch) and V0006 (trains-route cleanup, on the
-- Phase 6 branch). Refinery applies in version order; either of the
-- gap-filling migrations lands cleanly when its branch merges.

CREATE TABLE IF NOT EXISTS power_gen (
    id              TEXT PRIMARY KEY NOT NULL,                 -- uuid
    factory_id      TEXT NOT NULL REFERENCES factory(id) ON DELETE CASCADE,
    -- IDs into the bundled game data; no FK because the dataset is in
    -- memory, not in this DB. The slice command layer validates them.
    generator_id    TEXT NOT NULL,
    fuel_item_id    TEXT NOT NULL,
    count           INTEGER NOT NULL DEFAULT 1 CHECK (count >= 1),
    -- Same x100 trick + 1..250% clamp as `factory_machine`.
    clock_pct_x100  INTEGER NOT NULL DEFAULT 10000
        CHECK (clock_pct_x100 BETWEEN 100 AND 25000),
    notes           TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_power_gen_factory ON power_gen(factory_id);
