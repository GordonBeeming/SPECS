-- Factory + factory_machine schema for the active playthrough.
-- Each playthrough .specsdb file owns its own copy.

CREATE TABLE IF NOT EXISTS factory (
    id          TEXT PRIMARY KEY NOT NULL,         -- uuid
    name        TEXT NOT NULL,
    world_x     REAL NOT NULL DEFAULT 0,
    world_y     REAL NOT NULL DEFAULT 0,
    color       TEXT,                              -- optional hex; null = use brand primary
    notes       TEXT,
    created_at  TEXT NOT NULL,                     -- ISO 8601 UTC
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_factory_name ON factory(name);

CREATE TABLE IF NOT EXISTS factory_machine (
    id            TEXT PRIMARY KEY NOT NULL,       -- uuid
    factory_id    TEXT NOT NULL REFERENCES factory(id) ON DELETE CASCADE,
    -- IDs reference the bundled game data — no FK because the dataset lives in
    -- memory, not in this DB. The slice repo validates them on insert/update.
    building_id   TEXT NOT NULL,
    recipe_id     TEXT NOT NULL,
    count         INTEGER NOT NULL DEFAULT 1 CHECK (count >= 1),
    -- Stored as 100ths of a percent so we can express 200% precisely as 20000
    -- without floating-point drift. UI converts to/from 0.0–250.0%.
    clock_pct_x100 INTEGER NOT NULL DEFAULT 10000 CHECK (clock_pct_x100 BETWEEN 100 AND 25000),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_factory_machine_factory ON factory_machine(factory_id);
