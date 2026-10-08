import { isSettingsGroup, type SettingsGroup } from '@dcbot/database';

/**
 * Dashboard settings write policy.
 *
 * Kept free of Next.js imports so the rules that decide *what the dashboard is
 * allowed to change* are unit-testable on their own, and so the route handler
 * stays a thin HTTP adapter.
 */

/** Hard cap on a settings payload (serialised JSON length). */
export const MAX_SETTINGS_PAYLOAD_BYTES = 16_000;

/**
 * Settings groups the dashboard may write.
 *
 * `branding`, `no_tag` and `no_pin` are deliberately absent: those are owner /
 * staff command territory and are not exposed to the web UI.
 */
export const WRITABLE_SETTINGS_GROUPS: readonly SettingsGroup[] = [
  'moderation',
  'automod',
  'security',
  'tickets',
  'welcome',
  'logging',
  'economy',
  'leveling',
  'music',
  'suggestions',
  'reaction_roles',
];

const WRITABLE: ReadonlySet<string> = new Set(WRITABLE_SETTINGS_GROUPS);

export function isWritableSettingsGroup(group: unknown): group is SettingsGroup {
  return typeof group === 'string' && isSettingsGroup(group) && WRITABLE.has(group);
}

export type SettingsRequestResult =
  | { ok: true; group: SettingsGroup; patch: Record<string, unknown> }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Validates the shape of a settings write. Authorization is *not* decided here -
 * the caller must still verify the session and the guild membership.
 */
export function validateSettingsRequest(body: unknown): SettingsRequestResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Request body must be a JSON object.' };
  }
  const { group, patch } = body as { group?: unknown; patch?: unknown };

  if (!isWritableSettingsGroup(group)) {
    return {
      ok: false,
      status: 400,
      error: `Settings group "${String(group)}" is not writable from the dashboard.`,
    };
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, status: 400, error: 'patch must be an object.' };
  }
  if (JSON.stringify(patch).length > MAX_SETTINGS_PAYLOAD_BYTES) {
    return { ok: false, status: 413, error: 'Settings payload is too large.' };
  }
  return { ok: true, group, patch: patch as Record<string, unknown> };
}

/** Snowflake shape check for path parameters, so a forged ID cannot reach SQL. */
export function isSnowflakeParam(value: string | undefined | null): boolean {
  return typeof value === 'string' && /^[0-9]{15,25}$/.test(value);
}
