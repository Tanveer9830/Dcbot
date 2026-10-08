import { NextResponse } from 'next/server';
import { STATE_COOKIE, generateState } from '../../../../lib/session';
import { env } from '../../../../lib/env';

/** Starts the Discord OAuth2 authorization-code flow. */
export function GET(): NextResponse {
  const config = env();
  if (!config.DISCORD_CLIENT_ID || !config.DISCORD_REDIRECT_URI) {
    return NextResponse.json(
      { error: 'OAuth2 is not configured. Set DISCORD_CLIENT_ID and DISCORD_REDIRECT_URI.' },
      { status: 500 },
    );
  }

  const state = generateState();
  const params = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    redirect_uri: config.DISCORD_REDIRECT_URI,
    response_type: 'code',
    // identify: who the user is. guilds: which servers they can manage.
    scope: 'identify guilds',
    state,
    prompt: 'consent',
  });

  const response = NextResponse.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return response;
}
