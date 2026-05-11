-- Persist (x, y) positions for each machine in a factory so the
-- graph view doesn't re-run dagre on every render and the user's
-- manual nudges survive reloads.
--
-- Sparse — a missing row means "use dagre's auto-laid-out position".
-- machine_id FKs to factory_machine so a machine delete cleans the
-- layout up automatically.

CREATE TABLE IF NOT EXISTS factory_machine_layout (
    machine_id  TEXT PRIMARY KEY NOT NULL
        REFERENCES factory_machine(id) ON DELETE CASCADE,
    x           REAL NOT NULL,
    y           REAL NOT NULL,
    updated_at  TEXT NOT NULL
);
