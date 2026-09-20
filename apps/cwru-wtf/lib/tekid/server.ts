import 'server-only';

import { getLogtoContext } from '@logto/next/server-actions';

import { getTekidConfig } from './config';
import { getTekidAuthContextFromClaims } from './profile';
import type { AuthContextType } from './types';

export async function getTekidAuthContext(): Promise<AuthContextType> {
  const { isAuthenticated, claims } = await getLogtoContext(getTekidConfig());
  return getTekidAuthContextFromClaims(isAuthenticated, claims);
}
