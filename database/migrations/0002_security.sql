-- 0002_security.sql
-- Server security: events, trusted principals, /no-tag protection and
-- /no-pin monitoring.

CREATE TABLE IF NOT EXISTS security_settings (
    guild_id            TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    anti_nuke_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    anti_raid_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    anti_spam_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    join_threshold      INTEGER NOT NULL DEFAULT 5,
    join_window_ms      INTEGER NOT NULL DEFAULT 10000,
    spam_threshold      INTEGER NOT NULL DEFAULT 5,
    spam_window_ms      INTEGER NOT NULL DEFAULT 5000,
    mention_threshold   INTEGER NOT NULL DEFAULT 10,
    min_account_age_days INTEGER NOT NULL DEFAULT 0,
    lockdown_on_trigger BOOLEAN NOT NULL DEFAULT FALSE,
    alert_channel_id    TEXT,
    config_history      JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_by          TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_trusted_users (
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    reason      TEXT,
    granted_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS security_trusted_roles (
    guild_id    TEXT NOT NULL,
    role_id     TEXT NOT NULL,
    reason      TEXT,
    granted_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, role_id)
);

CREATE TABLE IF NOT EXISTS security_events (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    type        TEXT NOT NULL,
    severity    TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    actor_id    TEXT,
    channel_id  TEXT,
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    action_taken TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_events_guild_time_idx ON security_events (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_type_idx ON security_events (guild_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_actor_idx ON security_events (guild_id, actor_id, created_at DESC);

-- /no-tag: users protected against unwanted mentions.
CREATE TABLE IF NOT EXISTS no_tag_protected (
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'delete' CHECK (mode IN ('log','delete','warn','timeout')),
    exempt_role_ids TEXT[] NOT NULL DEFAULT '{}',
    exempt_user_ids TEXT[] NOT NULL DEFAULT '{}',
    set_by      TEXT NOT NULL,
    self_selected BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS no_tag_violations (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT,
    message_id  TEXT,
    protected_user_id TEXT NOT NULL,
    offender_id TEXT NOT NULL,
    action_taken TEXT NOT NULL DEFAULT 'none',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS no_tag_violations_guild_idx ON no_tag_violations (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS no_tag_violations_offender_idx ON no_tag_violations (guild_id, offender_id, created_at DESC);

-- /no-pin: monitoring only. Discord does not expose a pre-pin hook, so this
-- table records observed pin/unpin activity plus the audit-log attribution
-- when the bot could determine it.
CREATE TABLE IF NOT EXISTS no_pin_events (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    pinned      BOOLEAN NOT NULL,
    actor_id    TEXT,
    actor_source TEXT NOT NULL DEFAULT 'unknown' CHECK (actor_source IN ('audit_log','message_author','unknown')),
    message_id  TEXT,
    action_taken TEXT NOT NULL DEFAULT 'none',
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS no_pin_events_guild_idx ON no_pin_events (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS no_pin_events_channel_idx ON no_pin_events (guild_id, channel_id, created_at DESC);
