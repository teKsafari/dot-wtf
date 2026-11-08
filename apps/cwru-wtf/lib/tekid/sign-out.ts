import 'server-only';

import { buildEndSessionUrl } from 'openid-client';
import { redirect, unstable_rethrow } from 'next/navigation';

import { getTekidConfig } from './config';
import { getTekidProvider } from './provider';
import { getTekidReturnPath } from './redirects';
import { clearTekidSession, readTekidSession } from './session';

export async function endTekidSession(returnTo: unknown): Promise<void> {
  const config = getTekidConfig();
  const returnPath = getTekidReturnPath(returnTo);
  const returnUrl = new URL(returnPath, config.baseUrl).href;
  let target = returnUrl;

  // Drop the local session first: the visitor is signed out of this app either way.
  const session = await readTekidSession(config);
  await clearTekidSession();

  try {
    const provider = await getTekidProvider(config);
    target = buildEndSessionUrl(provider, {
      post_logout_redirect_uri: returnUrl,
      ...(session?.idToken ? { id_token_hint: session.idToken } : {}),
    }).href;
  } catch (error) {
    unstable_rethrow(error);
    // No reachable end-session endpoint: the local sign-out above still stands.
  }

  redirect(target);
}
