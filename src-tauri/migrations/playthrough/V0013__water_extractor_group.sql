-- Water extractors are free-placed in game (not node-bound), so the
-- node catalog has nothing to claim. A group row is ONE map marker
-- representing N extractors — "40 @ 100%" — placed anywhere the user
-- likes (planning, not placement validity).
--
-- A group holds up to two banks so mixed clocks fit on one marker
-- ("40 @ 100% and 2 @ 45%"). Bank 2 is the nullable pair; the CHECK
-- keeps count2/clock2 in lockstep so a half-filled bank can't exist.
CREATE TABLE IF NOT EXISTS water_extractor_group (
    id               TEXT PRIMARY KEY NOT NULL,    -- uuid
    world_x          REAL NOT NULL,
    world_y          REAL NOT NULL,
    count            INTEGER NOT NULL CHECK (count >= 1),
    -- Same x100 convention as factory_machine.clock_pct_x100.
    clock_pct_x100   INTEGER NOT NULL CHECK (clock_pct_x100 BETWEEN 100 AND 25000),
    count2           INTEGER CHECK (count2 IS NULL OR count2 >= 1),
    clock2_pct_x100  INTEGER CHECK (clock2_pct_x100 IS NULL OR clock2_pct_x100 BETWEEN 100 AND 25000),
    -- Output feeds this factory's supply, same as a bound node claim.
    factory_id       TEXT REFERENCES factory(id) ON DELETE SET NULL,
    notes            TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    CHECK ((count2 IS NULL) = (clock2_pct_x100 IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_water_extractor_group_factory
    ON water_extractor_group(factory_id);
