import { z } from 'zod';

import { requireDashboardPermission } from '@/lib/authorization';
import { assertSameOriginMutation } from '@/lib/member-request';
import { ApplicationError } from '@/lib/applications';
import { getApplicationService } from '@/lib/applications-server';
import { applicationApiError } from '@/lib/application-response';

const bodySchema = z.object({ action: z.enum(['approve', 'reject', 'remint-link']) }).strict();
const userIdSchema = z.string().uuid();

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    assertSameOriginMutation(request);
    const actor = await requireDashboardPermission('members:review');
    const { userId } = await context.params;
    const application = userIdSchema.safeParse(userId);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!application.success || !body.success) {
      throw new ApplicationError(400, 'Choose an application and an action.');
    }

    const service = getApplicationService();
    const actorId = actor.claims.sub;
    if (body.data.action === 'approve') {
      return Response.json(await service.approve(application.data, actorId), {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (body.data.action === 'reject') {
      return Response.json({ application: await service.reject(application.data, actorId) }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return Response.json({ link: await service.remintSignInLink(application.data, actorId) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return applicationApiError(error);
  }
}
