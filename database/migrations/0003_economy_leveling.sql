-- 0003_economy_leveling.sql
-- Virtual economy (game currency only, no real money) and XP/leveling.

CREATE TABLE IF NOT EXISTS economy_accounts (
    guild_id        TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    wallet          BIGINT NOT NULL DEFAULT 0 CHECK (wallet >= 0),
    bank            BIGINT NOT NULL DEFAULT 0 CHECK (bank >= 0),
    total_earned    BIGINT NOT NULL DEFAULT 0,
    total_spent     BIGINT NOT NULL DEFAULT 0,
    daily_claimed_at  TIMESTAMPTZ,
    weekly_claimed_at TIMESTAMPTZ,
    work_claimed_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, user_id)
);

-- Ledger: every balance change is append-only and reconcilable.
CREATE TABLE IF NOT EXISTS economy_transactions (
    id            BIGSERIAL PRIMARY KEY,
    guild_id      TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN (
                    'daily','weekly','work','transfer','purchase','sale','admin_adjust',
                    'quest','achievement','levelup','giveaway')),
    amount        BIGINT NOT NULL,
    wallet_after  BIGINT NOT NULL,
    bank_after    BIGINT NOT NULL,
    counterparty_id TEXT,
    memo          TEXT,
    -- Idempotency guard: a given key can only ever produce one ledger entry.
    idempotency_key TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS economy_transactions_idempotency_uidx
    ON economy_transactions (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS economy_transactions_user_idx ON economy_transactions (guild_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS economy_transactions_kind_idx ON economy_transactions (guild_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS shop_items (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price       BIGINT NOT NULL CHECK (price > 0),
    stock       INTEGER,
    role_id     TEXT,
    kind        TEXT NOT NULL DEFAULT 'role' CHECK (kind IN ('role','consumable','collectible')),
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (guild_id, name)
);

CREATE TABLE IF NOT EXISTS inventory_items (
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    item_id     BIGINT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
    quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, user_id, item_id)
);

CREATE TABLE IF NOT EXISTS quests (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    key         TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    goal        INTEGER NOT NULL CHECK (goal > 0),
    reward      BIGINT NOT NULL CHECK (reward >= 0),
    metric      TEXT NOT NULL DEFAULT 'messages' CHECK (metric IN ('messages','commands','voice_minutes','transfers')),
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (guild_id, key)
);

CREATE TABLE IF NOT EXISTS user_quests (
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    quest_id    BIGINT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
    progress    INTEGER NOT NULL DEFAULT 0,
    completed_at TIMESTAMPTZ,
    claimed_at  TIMESTAMPTZ,
    PRIMARY KEY (guild_id, user_id, quest_id)
);

CREATE TABLE IF NOT EXISTS achievements (
    id          BIGSERIAL PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS user_achievements (
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    achievement_id BIGINT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS xp_profiles (
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    xp          BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
    level       INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
    messages    BIGINT NOT NULL DEFAULT 0,
    last_xp_at  TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS xp_profiles_leaderboard_idx ON xp_profiles (guild_id, xp DESC);
CREATE INDEX IF NOT EXISTS xp_profiles_cooldown_idx ON xp_profiles (guild_id, last_xp_at);

CREATE TABLE IF NOT EXISTS level_role_rewards (
    guild_id    TEXT NOT NULL,
    level       INTEGER NOT NULL CHECK (level > 0),
    role_id     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, level)
);
