'use server';

import { signIn, signOut } from '@logto/next/server-actions';
import { redirect, unstable_rethrow } from 'next/navigation';

import {
  getTekidConfig,
  tekidCallbackPath,
  tekidProfilePath,
} from '@/lib/tekid/config';

export async function signInWithTekid(): Promise<void> {
  const config = getTekidConfig();

  try {
    await signIn(config, {
      redirectUri: new URL(tekidCallbackPath, config.baseUrl),
      postRedirectUri: new URL(tekidProfilePath, config.baseUrl),
    });
  } catch (error) {
    // The SDK uses Next.js redirects, which must reach the framework unchanged.
    unstable_rethrow(error);
    redirect(`${tekidProfilePath}?error=sign-in`);
  }
}

export async function signOutFromTekid(): Promise<void> {
  const config = getTekidConfig();

  try {
    await signOut(config, new URL(tekidProfilePath, config.baseUrl).href);
  } catch (error) {
    unstable_rethrow(error);
    redirect(`${tekidProfilePath}?error=sign-out`);
  }
}
