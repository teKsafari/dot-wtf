import { getLogtoContext } from '@logto/next/server-actions';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';

import { getTekidConfig } from '@/lib/tekid/config';
import { getTekidReturnPath } from '@/lib/tekid/redirects';
import { beginTekidSignIn } from '@/lib/tekid/sign-in';

export async function GET(request: NextRequest) {
  const returnTo = getTekidReturnPath(request.nextUrl.searchParams.get('returnTo'));
  const { isAuthenticated } = await getLogtoContext(getTekidConfig());

  if (isAuthenticated) redirect(returnTo);
  await beginTekidSignIn(returnTo);
}
