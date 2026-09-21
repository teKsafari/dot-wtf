'use server';

import { signOut } from '@logto/next/server-actions';
import { cookies } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import {
  getTekidConfig,
  tekidProfilePath,
} from '@/lib/tekid/config';
import { dashboardHintCookieName } from '@/lib/tekid/dashboard-hint';
import { beginTekidSignIn } from '@/lib/tekid/sign-in';

export async function signInWithTekid(): Promise<void> {
  await beginTekidSignIn(tekidProfilePath);
}

export async function signOutFromTekid(): Promise<void> {
  const config = getTekidConfig();

  try {
    (await cookies()).delete(dashboardHintCookieName);
    await signOut(config, new URL(tekidProfilePath, config.baseUrl).href);
  } catch (error) {
    unstable_rethrow(error);
    redirect(`${tekidProfilePath}?error=sign-out`);
  }
}
