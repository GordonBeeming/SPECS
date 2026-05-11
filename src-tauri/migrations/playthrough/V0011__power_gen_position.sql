-- Power-gen rows get their own world position so each generator
-- (or generator group) appears as its own map pin instead of
-- inheriting its parent factory's coords. Nullable: a generator
-- with no position falls through to the factory's pin via the
-- React render path so existing rows keep working.

ALTER TABLE power_gen ADD COLUMN world_x REAL;
ALTER TABLE power_gen ADD COLUMN world_y REAL;
