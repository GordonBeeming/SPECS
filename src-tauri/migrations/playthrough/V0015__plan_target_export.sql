-- A target is what the factory MAKES; export_ipm is the slice of it
-- offered to other factories ("produce 500, export 300, keep 200").
-- NULL = nothing offered. The source picker reads these offers and
-- subtracts what other factories already draw via logistics links to
-- show remaining capacity.
ALTER TABLE factory_plan_target ADD COLUMN export_ipm_x100 INTEGER
    CHECK (export_ipm_x100 IS NULL OR export_ipm_x100 >= 0);
