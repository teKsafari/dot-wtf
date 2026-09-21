import 'server-only';

import { getTekidConfig } from './config';
import { TekidAuthorizationError } from './authorization';

export function assertSameOriginMutation(
  request: Request,
  expectedOrigin = new URL(getTekidConfig().baseUrl).origin
): void {
  if (request.headers.get('origin') !== expectedOrigin) {
    throw new TekidAuthorizationError(403, 'This action must be submitted from this site.');
  }
}
