import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { destroySession, sessionCookieName, sessionCookieOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Signing out deletes the session row as well as the cookie, so a copied
 * cookie value cannot be replayed afterwards. The body is ignored on purpose:
 * a sign-out button should work even when it posts nothing at all.
 */
export async function POST() {
  const jar = await cookies();
  const sid = jar.get(sessionCookieName)?.value;
  if (sid) destroySession(sid);

  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set(sessionCookieName, '', { ...sessionCookieOptions, maxAge: 0 });
  return res;
}
