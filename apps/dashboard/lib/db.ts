import {
  AuditRepository,
  CustomCommandRepository,
  Database,
  GuildRepository,
  OverviewRepository,
  SecurityRepository,
  SessionRepository,
} from '@dcbot/database';
import { OwnerPolicy } from '@dcbot/shared';

/**
 * Dashboard database access.
 *
 * A single pooled connection is shared across requests. When DATABASE_URL is
 * absent the dashboard renders an explicit "not configured" state instead of
 * inventing numbers.
 */

let database: Database | null = null;
let failed = false;

export function getDb(): Database | null {
  if (database) return database;
  const url = process.env.DATABASE_URL;
  if (!url || failed) return null;
  try {
    database = new Database({
      connectionString: url,
      ssl: (process.env.DATABASE_SSL ?? 'false').toLowerCase() === 'true',
      max: 5,
      applicationName: 'dcbot-dashboard',
    });
    return database;
  } catch {
    failed = true;
    return null;
  }
}

export interface Repos {
  overview: OverviewRepository;
  guilds: GuildRepository;
  security: SecurityRepository;
  customCommands: CustomCommandRepository;
  audit: AuditRepository;
  sessions: SessionRepository;
}

export function getRepos(): Repos | null {
  const db = getDb();
  if (!db) return null;
  const owners = new OwnerPolicy({ raw: process.env.BOT_OWNER_IDS, strict: false });
  return {
    overview: new OverviewRepository(db),
    guilds: new GuildRepository(db),
    security: new SecurityRepository(db),
    customCommands: new CustomCommandRepository(db, owners),
    audit: new AuditRepository(db),
    sessions: new SessionRepository(db),
  };
}

/** Live database health for the owner panel. */
export async function dbHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const db = getDb();
  if (!db) return { ok: false, latencyMs: 0, error: 'DATABASE_URL is not configured' };
  return db.ping();
}
