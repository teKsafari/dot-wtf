import 'server-only';

import {
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import { redirect, unstable_rethrow } from 'next/navigation';

import { getTekidConfig, tekidCallbackPath } from './config';
import { getTekidProvider } from './provider';
import { getTekidReturnPath, tekidProfilePath } from './redirects';
import { writeTekidSignInFlow } from './session';

export async function beginTekidSignIn(returnTo: unknown = tekidProfilePath): Promise<void> {
  const config = getTekidConfig();
  let authorizationUrl: string;

  try {
    const provider = await getTekidProvider(config);
    const codeVerifier = randomPKCECodeVerifier();
    const state = randomState();
    const nonce = randomNonce();

    // The callback origin comes from configuration, never from a request header.
    const url = buildAuthorizationUrl(provider, {
      redirect_uri: new URL(tekidCallbackPath, config.baseUrl).href,
      scope: config.scopes.join(' '),
      state,
      nonce,
      code_challenge: await calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
    });

    await writeTekidSignInFlow(config, {
      codeVerifier,
      state,
      nonce,
      returnTo: getTekidReturnPath(returnTo),
    });
    authorizationUrl = url.href;
  } catch (error) {
    unstable_rethrow(error);
    redirect(`${tekidProfilePath}?error=sign-in`);
  }

  redirect(authorizationUrl);
}
