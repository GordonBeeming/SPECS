-- Phase 8: alt recipes (per-playthrough unlocked list) +
-- Somersloop / power-shard amplification on each factory_machine.
--
-- Both Somersloop and power-shard usage is strictly opt-in per machine
-- (`use_somersloop`, `power_shard_count`) — SPECS never assumes a player
-- wants to spend either resource just because they own them.

CREATE TABLE IF NOT EXISTS unlocked_alt_recipe (
    recipe_id   TEXT PRIMARY KEY NOT NULL,
    unlocked_at TEXT NOT NULL                            -- ISO 8601 UTC
);

-- Optional inventories the player can choose to track. Non-zero only
-- when the player wants the UI to nag them about depletion; the default
-- of 0 means "I don't care about supply, just let me amplify".
CREATE TABLE IF NOT EXISTS inventory_amplifier (
    id                   INTEGER PRIMARY KEY CHECK (id = 1),
    somersloop_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (somersloop_quantity >= 0),
    power_shard_quantity INTEGER NOT NULL DEFAULT 0 CHECK (power_shard_quantity >= 0)
);

-- Seed the singleton row so every read can use a `WHERE id = 1` scan
-- without an outer join.
INSERT OR IGNORE INTO inventory_amplifier (id) VALUES (1);

-- Extend `factory_machine` with opt-in amplification flags. Both
-- default to off so existing rows keep their pre-Phase-8 behaviour.
-- `somersloop_slots_filled` mirrors the in-game amplifier slot UI;
-- `power_shard_count` is 0..3 — the wiki cap.
ALTER TABLE factory_machine ADD COLUMN use_somersloop INTEGER NOT NULL DEFAULT 0
    CHECK (use_somersloop IN (0, 1));
ALTER TABLE factory_machine ADD COLUMN somersloop_slots_filled INTEGER NOT NULL DEFAULT 0
    CHECK (somersloop_slots_filled >= 0 AND somersloop_slots_filled <= 4);
ALTER TABLE factory_machine ADD COLUMN power_shard_count INTEGER NOT NULL DEFAULT 0
    CHECK (power_shard_count >= 0 AND power_shard_count <= 3);
