import { EncryptJWT, jwtDecrypt } from 'jose';
import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { env } from './env';

export const SESSION_COOKIE = 'dcbot_session';
export const STATE_COOKIE = 'dcbot_oauth_state';

/**
 * Session cookies are ENCRYPTED (JWE, A256GCM), not merely signed.
 *
 * The cookie carries the user's Discord access token so server components can
 * call Discord's API on their behalf. Encryption means the token is never
 * readable by the browser or by anyone who copies the cookie, and it is never
 * written to disk: dashboard_sessions stores SHA-256 hashes only, so a
 * database leak cannot be replayed against Discord.
 */

export interface SessionPayload {
  userId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  accessToken: string;
  tokenExpiresAt: number;
}

export interface PublicSession {
  userId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

function encryptionKey(): Uint8Array {
  const secret = env().SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters.');
  }
  return createHash('sha256').update(secret).digest();
}

const MAX_AGE_SECONDS = 60 * 60 * 12;

export async function signSession(payload: SessionPayload): Promise<string> {
  const lifetime = Math.max(
    60,
    Math.min(MAX_AGE_SECONDS, Math.floor((payload.tokenExpiresAt - Date.now()) / 1000)),
  );
  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setIssuer('dcbot-dashboard')
    .setExpirationTime(`${lifetime}s`)
    .encrypt(encryptionKey());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtDecrypt(token, encryptionKey(), { issuer: 'dcbot-dashboard' });
    if (typeof payload.userId !== 'string' || typeof payload.accessToken !== 'string') return null;
    return {
      userId: payload.userId,
      username: String(payload.username ?? ''),
      globalName: (payload.globalName as string | null) ?? null,
      avatar: (payload.avatar as string | null) ?? null,
      accessToken: payload.accessToken,
      tokenExpiresAt: Number(payload.tokenExpiresAt ?? 0),
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/** Session without the token, safe to pass to client components. */
export function publicSession(session: SessionPayload): PublicSession {
  return {
    userId: session.userId,
    username: session.username,
    globalName: session.globalName,
    avatar: session.avatar,
  };
}

export function sessionCookieOptions(): {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  };
}

/** Random OAuth state, validated against a short-lived cookie on callback. */
export function generateState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
