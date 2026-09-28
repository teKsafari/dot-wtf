import 'server-only';

import { unstable_rethrow } from 'next/navigation';
import { AuthorizationError } from './authorization';
import { MemberError } from './members';

export function memberApiError(error: unknown): Response {
  unstable_rethrow(error);
  if (error instanceof AuthorizationError || error instanceof MemberError) {
    return Response.json({ error: error.message }, {
      status: error.status, headers: { 'Cache-Control': 'no-store' },
    });
  }
  return Response.json({ error: 'Member management is temporarily unavailable. Please try again.' }, {
    status: 503, headers: { 'Cache-Control': 'no-store' },
  });
}

export { readMemberInput } from './member-input';
