-- 0001_core.sql
-- Core guild configuration, moderation records, audit trail, custom commands
-- and scheduled tasks. Snowflakes are stored as TEXT: they are identifiers,
-- never used for arithmetic, and TEXT avoids bigint precision surprises in JS.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS guilds (
    guild_id    TEXT PRIMARY KEY,
    name        TEXT,
    owner_id    TEXT,
    member_count INTEGER,
    bot_joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per guild holding feature configuration. Grouped JSONB columns keep
-- this from exploding into a table per setting while remaining queryable.
CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id        TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    moderation      JSONB NOT NULL DEFAULT '{}'::jsonb,
    automod         JSONB NOT NULL DEFAULT '{}'::jsonb,
    security        JSONB NOT NULL DEFAULT '{}'::jsonb,
    tickets         JSONB NOT NULL DEFAULT '{}'::jsonb,
    welcome         JSONB NOT NULL DEFAULT '{}'::jsonb,
    logging         JSONB NOT NULL DEFAULT '{}'::jsonb,
    economy         JSONB NOT NULL DEFAULT '{}'::jsonb,
    leveling        JSONB NOT NULL DEFAULT '{}'::jsonb,
    music           JSONB NOT NULL DEFAULT '{}'::jsonb,
    branding        JSONB NOT NULL DEFAULT '{"enabled": false}'::jsonb,
    no_tag          JSONB NOT NULL DEFAULT '{"enabled": false}'::jsonb,
    no_pin          JSONB NOT NULL DEFAULT '{"enabled": false}'::jsonb,
    suggestions     JSONB NOT NULL DEFAULT '{}'::jsonb,
    giveaways       JSONB NOT NULL DEFAULT '{}'::jsonb,
    reaction_roles  JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guild_settings_updated_at_idx ON guild_settings (updated_at);

CREATE TABLE IF NOT EXISTS moderation_cases (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    case_number INTEGER NOT NULL,
    type        TEXT NOT NULL CHECK (type IN (
                    'ban','unban','kick','timeout','untimeout','warn','purge',
                    'lock','unlock','softban','nickname','role_add','role_remove','note')),
    target_id   TEXT NOT NULL,
    actor_id    TEXT NOT NULL,
    reason      TEXT NOT NULL,
    evidence_url TEXT,
    expires_at  TIMESTAMPTZ,
    revoked     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (guild_id, case_number)
);

CREATE INDEX IF NOT EXISTS moderation_cases_guild_target_idx ON moderation_cases (guild_id, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS moderation_cases_guild_actor_idx  ON moderation_cases (guild_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS moderation_cases_active_timeouts_idx ON moderation_cases (guild_id, type, expires_at)
    WHERE type = 'timeout' AND revoked = FALSE;

CREATE TABLE IF NOT EXISTS warnings (
    id            BIGSERIAL PRIMARY KEY,
    guild_id      TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    moderator_id  TEXT NOT NULL,
    reason        TEXT NOT NULL,
    acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS warnings_guild_user_idx ON warnings (guild_id, user_id, created_at DESC);

-- Every privileged change (bot command or dashboard) is recorded here.
CREATE TABLE IF NOT EXISTS audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT,
    actor_id    TEXT NOT NULL,
    actor_kind  TEXT NOT NULL DEFAULT 'discord_user' CHECK (actor_kind IN ('discord_user','dashboard_user','bot_owner','system')),
    action      TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id   TEXT NOT NULL DEFAULT '',
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_hash     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_guild_idx ON audit_logs (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action, created_at DESC);

-- Custom commands. scope='global' rows are owner-only and have guild_id NULL.
-- scope='guild' rows are managed by that guild's administrators.
CREATE TABLE IF NOT EXISTS custom_commands (
    id                BIGSERIAL PRIMARY KEY,
    scope             TEXT NOT NULL CHECK (scope IN ('global','guild')),
    guild_id          TEXT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    description       TEXT NOT NULL,
    response_type     TEXT NOT NULL CHECK (response_type IN ('text','embed')),
    content           TEXT,
    embed             JSONB,
    ephemeral         BOOLEAN NOT NULL DEFAULT FALSE,
    delete_invocation BOOLEAN NOT NULL DEFAULT FALSE,
    enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by        TEXT NOT NULL,
    updated_by        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (scope <> 'global' OR guild_id IS NULL),
    CHECK (scope <> 'guild' OR guild_id IS NOT NULL),
    UNIQUE (scope, guild_id, name)
);

-- PostgreSQL treats NULLs as distinct in UNIQUE, so enforce global uniqueness
-- of global command names with a partial index.
CREATE UNIQUE INDEX IF NOT EXISTS custom_commands_global_name_uidx
    ON custom_commands (name) WHERE scope = 'global';

CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT,
    kind        TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    run_at      TIMESTAMPTZ NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    last_error  TEXT,
    completed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_tasks_due_idx ON scheduled_tasks (run_at)
    WHERE completed_at IS NULL;
