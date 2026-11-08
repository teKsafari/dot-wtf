import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';

import { getTekidConfig } from '@/lib/tekid/config';
import { getTekidReturnPath } from '@/lib/tekid/redirects';
import { readTekidSession } from '@/lib/tekid/session';
import { beginTekidSignIn } from '@/lib/tekid/sign-in';

export async function GET(request: NextRequest) {
  const returnTo = getTekidReturnPath(request.nextUrl.searchParams.get('returnTo'));
  // An incomplete profile is still a session; /profile reports the missing claim.
  const session = await readTekidSession(getTekidConfig());

  if (session) redirect(returnTo);
  await beginTekidSignIn(returnTo);
}
