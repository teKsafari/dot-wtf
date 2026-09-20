import 'server-only';

import { getLogtoContext } from '@logto/next/server-actions';

import { getTekidConfig } from './config';
import { getTekidProfileFromClaims, type TekidProfile } from './profile';

export async function getTekidProfile(): Promise<TekidProfile | null> {
  const { isAuthenticated, claims } = await getLogtoContext(getTekidConfig());
  return getTekidProfileFromClaims(isAuthenticated, claims);
}
