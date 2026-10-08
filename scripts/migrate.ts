#!/usr/bin/env tsx
/**
 * Migration CLI.
 *   npm run migrate          apply pending migrations
 *   npm run migrate:status   show which migrations are applied
 */
import { Database, migrationStatus, migrate } from '@dcbot/database';
import { loadEnv, redactConnectionString } from '@dcbot/config';

async function main(): Promise<void> {
  const statusOnly = process.argv.includes('--status');
  const env = loadEnv({ require: ['database'] });
  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exitCode = 1;
    return;
  }
  console.log(`[migrate] connecting to ${redactConnectionString(env.DATABASE_URL)}`);
  const db = new Database({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    max: 2,
    applicationName: 'dcbot-migrate',
  });
  try {
    if (statusOnly) {
      const status = await migrationStatus(db, env.MIGRATIONS_DIR);
      for (const entry of status) {
        console.log(`${entry.applied ? 'x' : ' '} ${entry.name}${entry.appliedAt ? ` (${entry.appliedAt})` : ''}`);
      }
      return;
    }
    const result = await migrate(db, env.MIGRATIONS_DIR, {
      strictChecksums: env.isProduction,
      onApply: (name) => console.log(`[migrate] applied ${name}`),
    });
    console.log(
      `[migrate] done. applied=${result.applied.length} skipped=${result.skipped.length}` +
        (result.checksumMismatch.length > 0
          ? ` checksum-mismatches=${result.checksumMismatch.map((m) => m.name).join(',')}`
          : ''),
    );
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error('[migrate] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
