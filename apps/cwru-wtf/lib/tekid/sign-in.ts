import 'server-only';

import { signIn } from '@logto/next/server-actions';
import { redirect, unstable_rethrow } from 'next/navigation';

import { getTekidConfig, tekidCallbackPath } from './config';
import { getTekidReturnPath, tekidProfilePath } from './redirects';

export async function beginTekidSignIn(returnTo: unknown = tekidProfilePath): Promise<void> {
  const config = getTekidConfig();

  try {
    await signIn(config, {
      redirectUri: new URL(tekidCallbackPath, config.baseUrl),
      postRedirectUri: new URL(getTekidReturnPath(returnTo), config.baseUrl),
    });
  } catch (error) {
    unstable_rethrow(error);
    redirect(`${tekidProfilePath}?error=sign-in`);
  }
}
