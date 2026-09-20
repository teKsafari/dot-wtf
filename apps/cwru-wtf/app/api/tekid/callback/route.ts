import { handleSignIn } from '@logto/next/server-actions';
import { redirect, unstable_rethrow } from 'next/navigation';
import type { NextRequest } from 'next/server';

import {
  getTekidConfig,
  tekidCallbackPath,
  tekidProfilePath,
} from '@/lib/tekid/config';

export async function GET(request: NextRequest) {
  const config = getTekidConfig();
  // Portless and production proxies can expose an internal request origin.
  const callbackUrl = new URL(tekidCallbackPath, config.baseUrl);
  callbackUrl.search = request.nextUrl.searchParams.toString();

  try {
    await handleSignIn(config, callbackUrl);
  } catch (error) {
    unstable_rethrow(error);
    redirect(`${tekidProfilePath}?error=sign-in`);
  }

  redirect(tekidProfilePath);
}
