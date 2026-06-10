-- Locking a water extractor group pins it to the map: dragging a
-- locked group starts the bind-to-factory gesture (same as resource
-- nodes) instead of moving the marker. Placement stays drag-to-move
-- until the user locks it in.
ALTER TABLE water_extractor_group ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
