-- Production plan per factory. Only the plan INPUTS are persisted —
-- targets, per-item recipe choices, and import cut points. The graph
-- itself (machine counts, edges, rates) is recomputed from these plus
-- the bundled game data, so a dataset update can never leave a stale
-- graph on disk.

-- "Make N of item X per minute in this factory." A factory can have
-- several products; UNIQUE keeps one row per item.
CREATE TABLE IF NOT EXISTS factory_plan_target (
    id          TEXT PRIMARY KEY NOT NULL,         -- uuid
    factory_id  TEXT NOT NULL REFERENCES factory(id) ON DELETE CASCADE,
    -- Game-data item id (`Desc_*_C`). No FK — the dataset lives in
    -- memory, not in this DB; the repo validates on write.
    item_id     TEXT NOT NULL,
    -- Stored as 100ths (6000 = 60/min) to avoid float drift, same
    -- convention as factory_machine.clock_pct_x100.
    ipm_x100    INTEGER NOT NULL CHECK (ipm_x100 > 0),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (factory_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_target_factory
    ON factory_plan_target(factory_id);

-- User-chosen recipe per produced item ("use the Pure Iron Ingot alt
-- for Iron Ingot here"). Items without a row use the planner's pick.
CREATE TABLE IF NOT EXISTS factory_plan_recipe (
    factory_id  TEXT NOT NULL REFERENCES factory(id) ON DELETE CASCADE,
    item_id     TEXT NOT NULL,
    recipe_id   TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (factory_id, item_id)
);

-- "Don't build item X here — it arrives from elsewhere." Cuts the plan
-- graph at the item. source_factory_id NULL is the load-bearing state:
-- an UNSOURCED input ("a future factory will supply this") that the
-- whole-playthrough backwards-planning flow depends on. Kept separate
-- from logistics_link on purpose — an import is intent, a link is a
-- realized route with transport details; this also keeps every
-- existing logistics_link consumer free of null-source handling.
CREATE TABLE IF NOT EXISTS factory_plan_import (
    id                 TEXT PRIMARY KEY NOT NULL,  -- uuid
    factory_id         TEXT NOT NULL REFERENCES factory(id) ON DELETE CASCADE,
    item_id            TEXT NOT NULL,
    source_factory_id  TEXT REFERENCES factory(id) ON DELETE SET NULL,
    -- Max ipm the source can spare. NULL ≈ unbounded.
    ipm_cap_x100       INTEGER CHECK (ipm_cap_x100 IS NULL OR ipm_cap_x100 > 0),
    -- Allocation order when several sources feed the same item.
    sort_order         INTEGER NOT NULL DEFAULT 0,
    -- The logistics link materialized for this import on plan save,
    -- so a re-save can reconcile (delete + recreate) instead of
    -- duplicating. NULL while the import is unsourced.
    logistics_link_id  TEXT REFERENCES logistics_link(id) ON DELETE SET NULL,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_import_factory
    ON factory_plan_import(factory_id);
-- Powers "which factories are waiting on item X?" lookups.
CREATE INDEX IF NOT EXISTS idx_plan_import_item
    ON factory_plan_import(item_id);

-- Designer node positions. Sparse — a missing row means "use the
-- auto layout" (same contract as factory_machine_layout). node_key is
-- item-based ("recipe:Desc_IronPlate_C", "raw:Desc_OreIron_C",
-- "import:Desc_IronPlate_C", "byproduct:...") so a recipe swap keeps
-- the node's position.
CREATE TABLE IF NOT EXISTS factory_plan_layout (
    factory_id  TEXT NOT NULL REFERENCES factory(id) ON DELETE CASCADE,
    node_key    TEXT NOT NULL,
    x           REAL NOT NULL,
    y           REAL NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (factory_id, node_key)
);

-- Machines materialized from a plan carry their originating node key;
-- NULL marks a manually-added (or pre-plan legacy) machine. Plan saves
-- regenerate only the tagged rows, so manual machines survive.
ALTER TABLE factory_machine ADD COLUMN plan_node_key TEXT;
