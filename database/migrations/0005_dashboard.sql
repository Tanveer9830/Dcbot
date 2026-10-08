-- 0005_dashboard.sql
-- Dashboard sessions plus read models the dashboard queries directly.

CREATE TABLE IF NOT EXISTS dashboard_sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    username    TEXT,
    global_name TEXT,
    avatar      TEXT,
    access_token_hash TEXT NOT NULL,
    refresh_token_hash TEXT,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dashboard_sessions_user_idx ON dashboard_sessions (user_id);
CREATE INDEX IF NOT EXISTS dashboard_sessions_expiry_idx ON dashboard_sessions (expires_at);

-- Read model: per-guild counters for the dashboard overview. Real counts only.
CREATE VIEW guild_overview AS
SELECT
    g.guild_id,
    g.name,
    g.member_count,
    g.bot_joined_at,
    COALESCE(mc.cases, 0)::BIGINT AS moderation_cases,
    COALESCE(w.total, 0)::BIGINT AS warnings,
    COALESCE(se.events, 0)::BIGINT AS security_events,
    COALESCE(t.open_tickets, 0)::BIGINT AS open_tickets,
    COALESCE(gv.active_giveaways, 0)::BIGINT AS active_giveaways,
    COALESCE(cc.guild_commands, 0)::BIGINT AS guild_commands,
    COALESCE(x.ranked_members, 0)::BIGINT AS ranked_members
FROM guilds g
LEFT JOIN (
    SELECT guild_id, COUNT(*) AS cases FROM moderation_cases GROUP BY guild_id
) mc ON mc.guild_id = g.guild_id
LEFT JOIN (
    SELECT guild_id, COUNT(*) AS total FROM warnings GROUP BY guild_id
) w ON w.guild_id = g.guild_id
LEFT JOIN (
    SELECT guild_id, COUNT(*) AS events FROM security_events GROUP BY guild_id
) se ON se.guild_id = g.guild_id
LEFT JOIN (
    SELECT guild_id, COUNT(*) AS open_tickets FROM tickets WHERE status <> 'closed' GROUP BY guild_id
) t ON t.guild_id = g.guild_id
LEFT JOIN (
    SELECT guild_id, COUNT(*) AS active_giveaways FROM giveaways WHERE ended = FALSE GROUP BY guild_id
) gv ON gv.guild_id = g.guild_id
LEFT JOIN (
    SELECT guild_id, COUNT(*) AS guild_commands FROM custom_commands WHERE enabled = TRUE GROUP BY guild_id
) cc ON cc.guild_id = g.guild_id
LEFT JOIN (
    SELECT guild_id, COUNT(*) AS ranked_members FROM xp_profiles GROUP BY guild_id
) x ON x.guild_id = g.guild_id;
