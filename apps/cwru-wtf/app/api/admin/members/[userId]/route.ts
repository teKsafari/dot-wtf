import { updateDashboardMemberRole } from '@/lib/tekid/members';
import { memberApiError, readMemberInput } from '@/lib/tekid/member-response';
import { assertSameOriginMutation } from '@/lib/tekid/request';

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    assertSameOriginMutation(request);
    const { userId } = await context.params;
    const member = await updateDashboardMemberRole(userId, await readMemberInput(request));
    return Response.json({ member }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return memberApiError(error);
  }
}
