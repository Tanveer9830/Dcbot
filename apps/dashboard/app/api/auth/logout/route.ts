import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, getSession } from '../../../../lib/session';
import { getRepos } from '../../../../lib/db';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (session) {
    await getRepos()?.sessions.revokeAllForUser(session.userId).catch(() => undefined);
  }
  const response = NextResponse.redirect(new URL('/', request.nextUrl.origin), { status: 303 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
