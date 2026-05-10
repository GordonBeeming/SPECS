-- App DB schema v1.
-- Tables here are app-wide metadata only. Per-playthrough state lives in the
-- separate playthrough .specsdb files (see migrations/playthrough/).

CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playthrough_registry (
    id              TEXT PRIMARY KEY NOT NULL,        -- uuid
    display_name    TEXT NOT NULL,
    file_path       TEXT NOT NULL UNIQUE,             -- absolute path of the .specsdb file we manage
    schema_version  INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,                    -- ISO 8601 UTC
    last_opened_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_playthrough_registry_last_opened
    ON playthrough_registry (last_opened_at DESC);

CREATE TABLE IF NOT EXISTS game_data_version (
    version       TEXT PRIMARY KEY NOT NULL,          -- e.g. "1.1.0"
    installed_at  TEXT NOT NULL                       -- ISO 8601 UTC
);
