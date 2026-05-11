-- Per-playthrough resource-node claims. The map's full node catalog
-- (location + purity per node) ships in `game-data/nodes.json` and is
-- read into memory at startup; this table only stores the user's
-- claims. Unclaimed = no row.
--
-- `node_id` is the SCIM `pathName` stem (e.g. `BP_ResourceNode13`),
-- matching the bundled catalog so commands can cross-reference without
-- a join. No FK because the catalog isn't in this DB.

CREATE TABLE IF NOT EXISTS resource_node_claim (
    node_id          TEXT PRIMARY KEY NOT NULL,
    -- Extractor placed on this node (e.g. `Build_MinerMk2_C`,
    -- `Build_FrackingSmasher_C`). NULL for geysers (geothermal vents
    -- feed generators, tracked in the power slice) and for nodes
    -- flagged "claimed but not built yet" — the UI surfaces those in
    -- red as "claim a miner".
    miner_id         TEXT,
    -- 1..250 percent, x100. Matches the clamp on factory_machine +
    -- power_gen so the UI components can share a single validator.
    clock_pct_x100   INTEGER NOT NULL DEFAULT 10000
        CHECK (clock_pct_x100 BETWEEN 100 AND 25000),
    -- Optional: which factory this node feeds. Lets the ledger surface
    -- a "from nodes: X ipm" chip and lets the planner avoid
    -- double-allocating supply that's already wired into a factory.
    factory_id       TEXT REFERENCES factory(id) ON DELETE SET NULL,
    notes            TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resource_node_claim_factory
    ON resource_node_claim(factory_id);
