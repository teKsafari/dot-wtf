import { authorizationCodeGrant, fetchUserInfo } from 'openid-client';
import { redirect, unstable_rethrow } from 'next/navigation';
import type { NextRequest } from 'next/server';

import { tekidClaimsFromProfile } from '@/lib/tekid/claims';
import {
  getTekidConfig,
  tekidCallbackPath,
  tekidProfilePath,
} from '@/lib/tekid/config';
import { getTekidProvider } from '@/lib/tekid/provider';
import {
  clearTekidSignInFlow,
  readTekidSignInFlow,
  writeTekidSession,
} from '@/lib/tekid/session';

export async function GET(request: NextRequest) {
  const config = getTekidConfig();
  // Portless and production proxies can expose an internal request origin.
  const callbackUrl = new URL(tekidCallbackPath, config.baseUrl);
  callbackUrl.search = request.nextUrl.searchParams.toString();

  let destination = tekidProfilePath;

  try {
    const flow = await readTekidSignInFlow(config);
    if (!flow) throw new Error('No sign-in flow is in progress for this browser.');

    const provider = await getTekidProvider(config);
    const tokens = await authorizationCodeGrant(provider, callbackUrl, {
      pkceCodeVerifier: flow.codeVerifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
    });

    const idTokenClaims = tokens.claims();
    if (!idTokenClaims) throw new Error('The provider returned no ID token.');

    // The ID token carries the identity; userinfo is the authority on profile fields.
    const userInfo = await fetchUserInfo(provider, tokens.access_token, idTokenClaims.sub);

    await clearTekidSignInFlow();
    await writeTekidSession(config, {
      claims: tekidClaimsFromProfile(idTokenClaims, userInfo),
      idToken: tokens.id_token,
    });
    destination = flow.returnTo;
  } catch (error) {
    unstable_rethrow(error);
    await clearTekidSignInFlow();
    // Keep provider responses and tokens out of the log.
    console.error('tekID sign-in could not be completed');
    redirect(`${tekidProfilePath}?error=sign-in`);
  }

  redirect(destination);
}
