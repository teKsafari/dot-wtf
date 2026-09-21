import { addDashboardMember, listDashboardMembers } from '@/lib/tekid/members';
import { memberApiError, readMemberInput } from '@/lib/tekid/member-response';
import { assertSameOriginMutation } from '@/lib/tekid/request';

export async function GET(request: Request) {
  try {
    const page = new URL(request.url).searchParams.get('page') ?? 1;
    return Response.json(await listDashboardMembers(page), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return memberApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginMutation(request);
    const member = await addDashboardMember(await readMemberInput(request));
    return Response.json({ member }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return memberApiError(error);
  }
}
