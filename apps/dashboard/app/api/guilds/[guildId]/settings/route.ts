import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '../../../../../lib/session';
import { AuthorizationFailure, assertGuildManager } from '../../../../../lib/authorization';
import { getRepos } from '../../../../../lib/db';
import { SETTINGS_GROUPS } from '@dcbot/database';
import {
  WRITABLE_SETTINGS_GROUPS,
  isSnowflakeParam,
  validateSettingsRequest,
} from '../../../../../lib/settingsPolicy';

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
    return NextResponse.json(
      { error: 'The dashboard has no database connection.' },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const validated = validateSettingsRequest(raw);
  if (!validated.ok) {
    return NextResponse.json(
      validated.status === 400
        ? { error: validated.error, allowed: [...WRITABLE_SETTINGS_GROUPS] }
        : { error: validated.error },
      { status: validated.status },
    );
  }
  if (!isSnowflakeParam(params.guildId)) {
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

  await repos.guilds.updateSettingsGroup(params.guildId, validated.group, validated.patch);
  await repos.audit.record({
    guildId: params.guildId,
    actorId: session.userId,
    actorKind: 'dashboard_user',
    action: `dashboard.settings.${validated.group}`,
    targetType: 'guild_settings',
    targetId: params.guildId,
    detail: { changedKeys: Object.keys(validated.patch) },
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  return NextResponse.json({ ok: true, group: validated.group });
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
