-- Logistics links between factories inside the active playthrough.
-- A link says "factory A is sending N items-per-minute of item X to factory B
-- via a chosen transport plan". The plan itself (which belts, which truck
-- route, which train, etc.) is stored as JSON because the shape varies per
-- transport_kind — Phase 5's planner generates ranked options and the user
-- picks one to persist here.

CREATE TABLE IF NOT EXISTS logistics_link (
    id                  TEXT PRIMARY KEY NOT NULL,             -- uuid
    from_factory_id     TEXT NOT NULL REFERENCES factory(id) ON DELETE CASCADE,
    to_factory_id       TEXT NOT NULL REFERENCES factory(id) ON DELETE CASCADE,
    -- Game-data ref (no FK — the dataset lives in memory, not in this DB).
    item_id             TEXT NOT NULL,
    -- Stored as 100ths of an ipm so 12.5 ipm round-trips precisely as 1250
    -- without f32 drift; same trick as factory_machine.clock_pct_x100.
    items_per_minute_x100 INTEGER NOT NULL CHECK (items_per_minute_x100 > 0),
    -- One of: 'belt' | 'pipe' | 'truck' | 'tractor' | 'train' | 'drone'.
    -- CHECK keeps free-form strings out of the column without locking us into
    -- a Rust enum at the schema level.
    transport_kind      TEXT NOT NULL CHECK (transport_kind IN
        ('belt','pipe','truck','tractor','train','drone')),
    -- Chosen plan returned from the planner (e.g.
    --   {"belts":[{"mark":6,"count":2}]}). Validated by the slice on write.
    transport_plan_json TEXT NOT NULL,
    -- Distance helps vehicle/drone cycle-time math; null until the user sets
    -- it (belts/pipes ignore it).
    distance_m          INTEGER CHECK (distance_m IS NULL OR distance_m >= 0),
    notes               TEXT,
    created_at          TEXT NOT NULL,                          -- ISO 8601 UTC
    updated_at          TEXT NOT NULL,
    -- Self-loops (A -> A) make no logistics sense; reject at the schema level.
    CHECK (from_factory_id <> to_factory_id)
);

CREATE INDEX IF NOT EXISTS idx_logistics_link_from ON logistics_link(from_factory_id);
CREATE INDEX IF NOT EXISTS idx_logistics_link_to   ON logistics_link(to_factory_id);
CREATE INDEX IF NOT EXISTS idx_logistics_link_item ON logistics_link(item_id);
