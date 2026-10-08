#!/usr/bin/env node
/**
 * Dependency audit gate.
 *
 * `npm audit` fails the build for every advisory in the tree, including ones we
 * have explicitly accepted and documented (see docs/SECURITY.md). That makes the
 * check red from day one and nobody looks at a permanently red check.
 *
 * This script keeps the gate real: any high/critical advisory whose package is
 * NOT on the allowlist fails the build. Allowlisted packages are listed here with
 * the reason, so adding one is a deliberate, reviewable change.
 *
 * Usage: node scripts/audit.mjs [--production-only]
 */
import { spawnSync } from 'node:child_process';

/**
 * Packages whose advisories are accepted for now.
 *
 * next / postcss: Next.js 14.2.x is the version this dashboard is built and
 * tested against. The published advisories cover 9.3.4-canary.0 through
 * 16.3.0-preview.10, so no Next 14 release is clean; the only "fix" is a major
 * upgrade to Next 16. The dashboard uses none of the affected surfaces
 * (no next/image remote patterns, no rewrites/redirects, no middleware, no
 * custom server, no i18n, no Server Actions, no beforeInteractive scripts),
 * which is why the exposure is accepted rather than ignored. Tracked in
 * docs/SECURITY.md with the upgrade as the remediation path.
 */
const ALLOWLIST = new Set(['next', 'postcss']);

const productionOnly = process.argv.includes('--production-only');
const args = ['audit', '--json', ...(productionOnly ? ['--omit=dev'] : [])];
const result = spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

if (result.error) {
  console.error(`Could not run npm audit: ${result.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch {
  console.error('npm audit did not return JSON.');
  console.error(result.stdout?.slice(0, 500));
  process.exit(1);
}

const SEVERITIES = new Set(['high', 'critical']);
const vulnerabilities = report.vulnerabilities ?? {};
const blocking = [];
const accepted = [];

for (const [name, entry] of Object.entries(vulnerabilities)) {
  const severity = entry.severity ?? 'unknown';
  if (!SEVERITIES.has(severity)) continue;
  const via = Array.isArray(entry.via) ? entry.via : [];
  const advisories = via
    .filter((item) => typeof item === 'object' && item !== null)
    .map((item) => item.title ?? item.url ?? 'advisory');
  if (ALLOWLIST.has(name)) {
    accepted.push({ name, severity, advisories });
    continue;
  }
  blocking.push({ name, severity, advisories });
}

const meta = report.metadata?.vulnerabilities ?? {};
console.log(
  `npm audit: critical=${meta.critical ?? 0} high=${meta.high ?? 0} moderate=${meta.moderate ?? 0} low=${meta.low ?? 0}`,
);

if (accepted.length > 0) {
  console.log('');
  console.log(`Accepted (${accepted.length}) - allowlisted in scripts/audit.mjs, documented in docs/SECURITY.md:`);
  for (const item of accepted) {
    console.log(`  - ${item.name} [${item.severity}] ${item.advisories.length} advisories`);
  }
}

if (blocking.length > 0) {
  console.log('');
  console.log('BLOCKING high/critical advisories:');
  for (const item of blocking) {
    console.log(`  - ${item.name} [${item.severity}]`);
    for (const advisory of item.advisories.slice(0, 5)) console.log(`      ${advisory}`);
  }
  console.log('');
  console.log('Fix these, or (after review) add the package to ALLOWLIST with a written reason.');
  process.exit(1);
}

console.log('No un-allowlisted high/critical advisories.');
