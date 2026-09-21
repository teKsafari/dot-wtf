import { cookies } from 'next/headers';

import {
  canOpenDashboard,
  getDashboardAuthContext,
  TekidAuthorizationError,
  type DashboardAuthContext,
} from '@/lib/tekid/authorization';
import {
  createDashboardHint,
  dashboardHintCookieName,
  dashboardHintCookieOptions,
} from '@/lib/tekid/dashboard-hint';
import { TekidProfileContractError } from '@/lib/tekid/profile';

const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  let auth: DashboardAuthContext;
  try {
    auth = await getDashboardAuthContext();
  } catch (error) {
    // An incomplete profile cannot use the dashboard and has no trustworthy
    // subject to bind a hint to.
    if (error instanceof TekidProfileContractError) {
      auth = { isAuthenticated: false };
    } else if (error instanceof TekidAuthorizationError && error.status === 503) {
      // Leave the stored hint alone; the client keeps its last verdict.
      return Response.json({ error: 'unavailable' }, { status: 503, headers });
    } else {
      throw error;
    }
  }

  const cookieStore = await cookies();
  if (!auth.isAuthenticated) {
    cookieStore.delete(dashboardHintCookieName);
    return Response.json({ allowed: false }, { headers });
  }

  const allowed = canOpenDashboard(auth);
  cookieStore.set(
    dashboardHintCookieName,
    createDashboardHint(auth.claims.sub, allowed),
    dashboardHintCookieOptions()
  );
  return Response.json({ allowed }, { headers });
}
