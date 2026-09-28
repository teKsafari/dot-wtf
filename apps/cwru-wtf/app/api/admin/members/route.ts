import { listDashboardMembers } from '@/lib/members';
import { memberApiError } from '@/lib/member-response';

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const page = params.get('page') ?? 1;
    const status = params.get('status') ?? 'all';
    return Response.json(await listDashboardMembers(page, status), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return memberApiError(error);
  }
}
