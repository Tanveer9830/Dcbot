import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  generateState,
  sessionCookieOptions,
  signSession,
} from '../../../../lib/session';
import { currentUser, type TokenResponse } from '../../../../lib/discord';
import { env } from '../../../../lib/env';
import { getRepos } from '../../../../lib/db';

/** Completes the OAuth2 flow: validates state, exchanges the code, sets the cookie. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = env();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const storedState = request.cookies.get(STATE_COOKIE)?.value;

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', config.DASHBOARD_URL ?? request.nextUrl.origin));
  }
  // CSRF protection: the state we issued must match the one Discord echoed.
  if (!state || !storedState || state !== storedState) {
    return NextResponse.redirect(new URL('/login?error=state_mismatch', config.DASHBOARD_URL ?? request.nextUrl.origin));
  }
  if (!config.DISCORD_CLIENT_SECRET || !config.DISCORD_REDIRECT_URI) {
    return NextResponse.json({ error: 'OAuth2 is not configured on this server.' }, { status: 500 });
  }

  const body = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID!,
    client_secret: config.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.DISCORD_REDIRECT_URI,
  });

  const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!tokenResponse.ok) {
    return NextResponse.redirect(new URL('/login?error=token_exchange', config.DASHBOARD_URL ?? request.nextUrl.origin));
  }
  const tokens = (await tokenResponse.json()) as TokenResponse;

  let user;
  try {
    user = await currentUser(tokens.access_token);
  } catch {
    return NextResponse.redirect(new URL('/login?error=user_fetch', config.DASHBOARD_URL ?? request.nextUrl.origin));
  }

  const sessionToken = await signSession({
    userId: user.id,
    username: user.username,
    globalName: user.global_name,
    avatar: user.avatar,
    accessToken: tokens.access_token,
    tokenExpiresAt: Date.now() + tokens.expires_in * 1000,
  });

  // Record the login with hashed tokens only.
  await getRepos()?.sessions
    .create({
      id: generateState(),
      userId: user.id,
      username: user.username,
      globalName: user.global_name,
      avatar: user.avatar,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    })
    .catch(() => undefined);

  const response = NextResponse.redirect(new URL('/dashboard', config.DASHBOARD_URL ?? request.nextUrl.origin));
  response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
  response.cookies.delete(STATE_COOKIE);
  return response;
}

