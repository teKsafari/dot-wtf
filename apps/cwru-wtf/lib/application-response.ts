import 'server-only';

import { unstable_rethrow } from 'next/navigation';
import { AuthorizationError } from './authorization';
import { ApplicationError } from './applications';
import { MemberError } from './members';

export function applicationApiError(error: unknown): Response {
  unstable_rethrow(error);
  if (error instanceof ApplicationError || error instanceof AuthorizationError || error instanceof MemberError) {
    return Response.json({ error: error.message }, {
      status: error.status, headers: { 'Cache-Control': 'no-store' },
    });
  }
  console.error('Unable to review a membership application');
  return Response.json({ error: 'Application review is temporarily unavailable. Please try again.' }, {
    status: 503, headers: { 'Cache-Control': 'no-store' },
  });
}
