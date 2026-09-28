import 'server-only';

import { getTekidConfig } from './tekid/config';
import { AuthorizationError } from './authorization';

export function assertSameOriginMutation(
  request: Request,
  expectedOrigin = new URL(getTekidConfig().baseUrl).origin
): void {
  if (request.headers.get('origin') !== expectedOrigin) {
    throw new AuthorizationError(403, 'This action must be submitted from this site.');
  }
}
