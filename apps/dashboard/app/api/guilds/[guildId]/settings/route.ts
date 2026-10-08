import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '../../../../../lib/session';
import { AuthorizationFailure, assertGuildManager } from '../../../../../lib/authorization';
import { getRepos } from '../../../../../lib/db';
import { SETTINGS_GROUPS, isSettingsGroup, type SettingsGroup } from '@dcbot/database';

/** Settings groups the dashboard may write, and their size limits. */
const WRITABLE: ReadonlySet<SettingsGroup> = new Set<SettingsGroup>([
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
]);

export interface SettingsRequest {
  group: string;
  patch: Record<string, unknown>;
}

/**
 * PATCH guild settings.
 *
 * Authorization is performed here on the server for every request:
 *  1. a valid session must exist,
 *  2. the guild ID is verified against the user's Discord guild list
 *     (MANAGE_GUILD required unless the user is a configured bot owner),
 *  3. the settings group must be on the allowlist,
 *  4. branding and no_tag/no_pin are deliberately NOT writable from the
 *     dashboard - they are owner/staff command territory.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { guildId: string } },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  }

  const repos = getRepos();
  if (!repos) {
    return NextResponse.json({ error: 'The dashboard has no database connection.' }, { status: 503 });
  }

  let body: SettingsRequest;
  try {
    body = (await request.json()) as SettingsRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!isSettingsGroup(body.group) || !WRITABLE.has(body.group)) {
    return NextResponse.json(
      { error: `Settings group "${String(body.group)}" is not writable from the dashboard.`, allowed: [...WRITABLE] },
      { status: 400 },
    );
  }
  if (!body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
    return NextResponse.json({ error: 'patch must be an object.' }, { status: 400 });
  }
  const serialized = JSON.stringify(body.patch);
  if (serialized.length > 16_000) {
    return NextResponse.json({ error: 'Settings payload is too large.' }, { status: 413 });
  }
  if (!/^[0-9]{15,25}$/.test(params.guildId)) {
    return NextResponse.json({ error: 'Invalid guild ID.' }, { status: 400 });
  }

  try {
    await assertGuildManager({ session, token: session.accessToken, guildId: params.guildId });
  } catch (error) {
    if (error instanceof AuthorizationFailure) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Could not verify your permissions.' }, { status: 403 });
  }

  await repos.guilds.updateSettingsGroup(params.guildId, body.group, body.patch);
  await repos.audit.record({
    guildId: params.guildId,
    actorId: session.userId,
    actorKind: 'dashboard_user',
    action: `dashboard.settings.${body.group}`,
    targetType: 'guild_settings',
    targetId: params.guildId,
    detail: { changedKeys: Object.keys(body.patch) },
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  return NextResponse.json({ ok: true, group: body.group });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { guildId: string } },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  const repos = getRepos();
  if (!repos) return NextResponse.json({ error: 'No database connection.' }, { status: 503 });
  try {
    await assertGuildManager({ session, token: session.accessToken, guildId: params.guildId });
  } catch {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }
  const settings = await repos.guilds.getSettings(params.guildId);
  const { guild_id: _guildId, updated_at: _updatedAt, ...groups } = settings;
  return NextResponse.json({ guildId: params.guildId, groups, available: SETTINGS_GROUPS });
}
