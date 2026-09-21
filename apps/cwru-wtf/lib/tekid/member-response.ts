import 'server-only';

import { unstable_rethrow } from 'next/navigation';
import { TekidAuthorizationError } from './authorization';
import { TekidMemberError } from './members';

export function memberApiError(error: unknown): Response {
  unstable_rethrow(error);
  if (error instanceof TekidAuthorizationError || error instanceof TekidMemberError) {
    return Response.json({ error: error.message }, {
      status: error.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  return Response.json({ error: 'tekID member management is temporarily unavailable. Please try again.' }, {
    status: 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function readMemberInput(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new TekidMemberError(400, 'Send member changes as JSON.');
  }
  try {
    return await request.json();
  } catch {
    throw new TekidMemberError(400, 'The member request contains invalid JSON.');
  }
}
