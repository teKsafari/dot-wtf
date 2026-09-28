import { reviewDashboardMember } from '@/lib/members';
import { memberApiError, readMemberInput } from '@/lib/member-response';
import { assertSameOriginMutation } from '@/lib/member-request';

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    assertSameOriginMutation(request);
    const { userId } = await context.params;
    const member = await reviewDashboardMember(userId, await readMemberInput(request));
    return Response.json({ member }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return memberApiError(error);
  }
}
