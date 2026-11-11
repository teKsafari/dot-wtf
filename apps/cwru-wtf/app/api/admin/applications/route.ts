import { requireDashboardPermission } from '@/lib/authorization';
import { getApplicationService } from '@/lib/applications-server';
import { applicationApiError } from '@/lib/application-response';

export async function GET() {
  try {
    await requireDashboardPermission('members:review');
    return Response.json(await getApplicationService().listQueue(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return applicationApiError(error);
  }
}
