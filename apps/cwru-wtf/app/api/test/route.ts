import { requireDashboardPermission } from '@/lib/authorization';
import { memberApiError } from '@/lib/member-response';

export async function GET() {
  try {
    await requireDashboardPermission('dashboard:access');
    // Permission checks query Postgres, so success also confirms database connectivity.
    return Response.json({ status: 'OK', message: 'Local membership database is available.' }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return memberApiError(error);
  }
}
