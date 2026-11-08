import 'server-only';

import { getTekidConfig } from './config';
import { getTekidAuthContextFromClaims } from './profile';
import { readTekidSession } from './session';
import type { AuthContextType } from './types';

export async function getTekidAuthContext(): Promise<AuthContextType> {
  const session = await readTekidSession(getTekidConfig());
  return getTekidAuthContextFromClaims(session !== null, session?.claims);
}
