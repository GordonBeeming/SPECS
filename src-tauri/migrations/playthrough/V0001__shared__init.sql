-- Playthrough DB schema v1.
-- One file per playthrough (`<uuid>.specsdb`). The unit of sharing.

-- Free-form key-value metadata. Known keys: name, game_version, created_at,
-- schema_version. Adding a key is non-breaking; removing one is.
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

-- Single-row table holding the player's progress through the milestone tree.
-- The `id = 1` check enforces "exactly one row" so the invariant is on the
-- DB even if a future caller forgets the WHERE clause; the queries today
-- still spell out `WHERE id = 1` for safety.
CREATE TABLE IF NOT EXISTS progress (
    id                          INTEGER PRIMARY KEY CHECK (id = 1),
    current_tier                INTEGER NOT NULL DEFAULT 0,
    current_milestone_progress  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS unlocked_milestone (
    milestone_id  TEXT PRIMARY KEY NOT NULL,
    tier          INTEGER NOT NULL,
    unlocked_at   TEXT NOT NULL                -- ISO 8601 UTC
);

CREATE INDEX IF NOT EXISTS idx_unlocked_milestone_tier
    ON unlocked_milestone (tier);

-- Alt-recipe unlocks (Hard Drive results). Recipe IDs reference the bundled
-- game data — no FK because the dataset is in-memory, not in this DB.
CREATE TABLE IF NOT EXISTS unlocked_alt_recipe (
    recipe_id    TEXT PRIMARY KEY NOT NULL,
    unlocked_at  TEXT NOT NULL
);
