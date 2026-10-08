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
    (SELECT COUNT(*) FROM moderation_cases mc WHERE mc.guild_id = g.guild_id) AS moderation_cases,
    (SELECT COUNT(*) FROM warnings w WHERE w.guild_id = g.guild_id) AS warnings,
    (SELECT COUNT(*) FROM security_events se WHERE se.guild_id = g.guild_id) AS security_events,
    (SELECT COUNT(*) FROM tickets t WHERE t.guild_id = g.guild_id AND t.status <> 'closed') AS open_tickets,
    (SELECT COUNT(*) FROM giveaways gv WHERE gv.guild_id = g.guild_id AND gv.ended = FALSE) AS active_giveaways,
    (SELECT COUNT(*) FROM custom_commands cc WHERE cc.guild_id = g.guild_id AND cc.enabled = TRUE) AS guild_commands,
    (SELECT COUNT(*) FROM xp_profiles x WHERE x.guild_id = g.guild_id) AS ranked_members
FROM guilds g;

-- Retention helper: called by the scheduled cleanup job.
CREATE OR REPLACE FUNCTION prune_old_rows(retention_days INTEGER DEFAULT 90)
RETURNS TABLE (security_events_deleted BIGINT, audit_logs_deleted BIGINT,
               no_tag_violations_deleted BIGINT, no_pin_events_deleted BIGINT) AS $$
DECLARE
    cutoff TIMESTAMPTZ := now() - (retention_days || ' days')::INTERVAL;
    se_count BIGINT; al_count BIGINT; nt_count BIGINT; np_count BIGINT;
BEGIN
    DELETE FROM security_events WHERE created_at < cutoff;
    GET DIAGNOSTICS se_count = ROW_COUNT;

    DELETE FROM audit_logs WHERE created_at < cutoff;
    GET DIAGNOSTICS al_count = ROW_COUNT;

    DELETE FROM no_tag_violations WHERE created_at < cutoff;
    GET DIAGNOSTICS nt_count = ROW_COUNT;

    DELETE FROM no_pin_events WHERE created_at < cutoff;
    GET DIAGNOSTICS np_count = ROW_COUNT;

    security_events_deleted := se_count;
    audit_logs_deleted := al_count;
    no_tag_violations_deleted := nt_count;
    no_pin_events_deleted := np_count;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION next_case_number(p_guild_id TEXT) RETURNS INTEGER AS $$
DECLARE next_value INTEGER;
BEGIN
    SELECT COALESCE(MAX(case_number), 0) + 1 INTO next_value
    FROM moderation_cases WHERE guild_id = p_guild_id;
    RETURN next_value;
END;
$$ LANGUAGE plpgsql;
