-- Player-chosen "vibe" icon for a factory, so a list of "Iron Plant",
-- "Steel Plant", "Heavy Forge" doesn't read as a wall of text.
--
-- Nullable: a factory without an icon falls back to the default
-- `Factory` glyph in the React layer. Stored as the game-data class id
-- (e.g. `Build_ManufacturerMk1_C`, `Desc_HeavyModularFrame_C`) so the
-- existing `<Icon itemId="…">` primitive resolves it without a new
-- lookup table.
ALTER TABLE factory ADD COLUMN icon_id TEXT;
