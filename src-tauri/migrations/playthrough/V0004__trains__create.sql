-- Train routes inside the active playthrough.
-- A `train_route` is a shared loop that visits 2+ factories in order
-- (`train_route_stop`); zero or more `logistics_link`s can be "attached"
-- to it via `train_route_link` so the player sees that link as carried
-- by the route rather than by its own dedicated transport. Cycle-time
-- estimates are stored alongside the route so the UI doesn't recompute
-- them on every render.

CREATE TABLE IF NOT EXISTS train_route (
    id                  TEXT PRIMARY KEY NOT NULL,         -- uuid
    name                TEXT NOT NULL,
    -- Number of freight cars (solid cargo) and fluid cars (fluid cargo)
    -- on the train; both default 0 because real layouts vary widely.
    freight_cars        INTEGER NOT NULL DEFAULT 0 CHECK (freight_cars >= 0),
    fluid_cars          INTEGER NOT NULL DEFAULT 0 CHECK (fluid_cars >= 0),
    -- Total round-trip distance in metres. Optional — the player may
    -- skip it for routes still being planned.
    total_distance_m    INTEGER CHECK (total_distance_m IS NULL OR total_distance_m >= 0),
    -- Cached cycle-time estimate in seconds. Refreshed by the slice
    -- whenever distance / cars / stops change.
    est_cycle_seconds   REAL CHECK (est_cycle_seconds IS NULL OR est_cycle_seconds > 0),
    notes               TEXT,
    created_at          TEXT NOT NULL,                      -- ISO 8601 UTC
    updated_at          TEXT NOT NULL,
    -- A route with zero cars carries nothing; rule them out at the schema
    -- level so the planner never recommends an empty train.
    CHECK (freight_cars + fluid_cars >= 1)
);

CREATE INDEX IF NOT EXISTS idx_train_route_name ON train_route(name);

CREATE TABLE IF NOT EXISTS train_route_stop (
    route_id            TEXT NOT NULL REFERENCES train_route(id) ON DELETE CASCADE,
    factory_id          TEXT NOT NULL REFERENCES factory(id) ON DELETE CASCADE,
    -- Position in the route (0-indexed). Two stops on the same route
    -- can't share an ordinal, but the same factory CAN appear twice on
    -- a route (back-and-forth shuttle pattern).
    ordinal             INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (route_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_train_route_stop_factory ON train_route_stop(factory_id);

-- Many-to-one: each logistics_link is carried by at most one train route
-- (a link is a single throughput commitment; if you split it across two
-- routes, the user creates two links). Composite PK on link_id alone
-- enforces the at-most-one rule.
CREATE TABLE IF NOT EXISTS train_route_link (
    link_id             TEXT PRIMARY KEY NOT NULL REFERENCES logistics_link(id) ON DELETE CASCADE,
    route_id            TEXT NOT NULL REFERENCES train_route(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_train_route_link_route ON train_route_link(route_id);
