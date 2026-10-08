-- 0004_community.sql
-- Tickets, giveaways, suggestions, reaction roles, starboard, polls,
-- birthdays and reminders.

CREATE TABLE IF NOT EXISTS tickets (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    opener_id   TEXT NOT NULL,
    claimed_by  TEXT,
    category    TEXT,
    reason      TEXT,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','closed')),
    rating      INTEGER CHECK (rating BETWEEN 1 AND 5),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS tickets_channel_uidx ON tickets (guild_id, channel_id);
CREATE INDEX IF NOT EXISTS tickets_guild_status_idx ON tickets (guild_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_opener_idx ON tickets (guild_id, opener_id, created_at DESC);

-- Transcript rows are kept for closed tickets; access is enforced in code.
CREATE TABLE IF NOT EXISTS ticket_messages (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id   TEXT NOT NULL,
    author_is_bot BOOLEAN NOT NULL DEFAULT FALSE,
    content     TEXT NOT NULL DEFAULT '',
    attachment_count INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_messages_ticket_idx ON ticket_messages (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS giveaways (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    message_id  TEXT NOT NULL,
    host_id     TEXT NOT NULL,
    prize       TEXT NOT NULL,
    winner_count INTEGER NOT NULL DEFAULT 1 CHECK (winner_count BETWEEN 1 AND 25),
    ends_at     TIMESTAMPTZ NOT NULL,
    ended       BOOLEAN NOT NULL DEFAULT FALSE,
    winner_ids  TEXT[] NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS giveaways_pending_idx ON giveaways (ends_at) WHERE ended = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS giveaways_message_uidx ON giveaways (guild_id, message_id);

CREATE TABLE IF NOT EXISTS giveaway_entries (
    giveaway_id BIGINT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS suggestions (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    message_id  TEXT NOT NULL,
    author_id   TEXT NOT NULL,
    title       TEXT NOT NULL,
    detail      TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','implemented')),
    upvotes     INTEGER NOT NULL DEFAULT 0,
    downvotes   INTEGER NOT NULL DEFAULT 0,
    decided_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS suggestions_guild_idx ON suggestions (guild_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS reaction_roles (
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    message_id  TEXT NOT NULL,
    emoji       TEXT NOT NULL,
    role_id     TEXT NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'toggle' CHECK (mode IN ('toggle','bind','unbind','verify')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, message_id, emoji)
);

CREATE TABLE IF NOT EXISTS starboard_entries (
    guild_id      TEXT NOT NULL,
    message_id    TEXT NOT NULL,
    channel_id    TEXT NOT NULL,
    starboard_message_id TEXT,
    stars         INTEGER NOT NULL DEFAULT 0,
    author_id     TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, message_id)
);

CREATE TABLE IF NOT EXISTS polls (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    message_id  TEXT NOT NULL,
    question    TEXT NOT NULL,
    options     TEXT[] NOT NULL,
    multi_vote  BOOLEAN NOT NULL DEFAULT FALSE,
    ends_at     TIMESTAMPTZ,
    closed      BOOLEAN NOT NULL DEFAULT FALSE,
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id     BIGINT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (poll_id, user_id, option_index)
);

CREATE TABLE IF NOT EXISTS birthdays (
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    day         INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS birthdays_month_day_idx ON birthdays (month, day);

CREATE TABLE IF NOT EXISTS reminders (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    content     TEXT NOT NULL,
    remind_at   TIMESTAMPTZ NOT NULL,
    sent_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders (remind_at) WHERE sent_at IS NULL;
