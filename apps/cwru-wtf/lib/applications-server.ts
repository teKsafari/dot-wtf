import 'server-only';

import { env } from '@/env';
import { db } from './db';
import {
  ApplicationError, createApplicationService, createDatabaseApplicationStore,
} from './applications';
import { createTekidAdminClient } from './tekid/admin';
import { createFilesystemUploadStore, isUploadKey } from './uploads';

const uploadsPath = '/api/uploads/';

export const uploadStore = createFilesystemUploadStore(env.UPLOADS_DIR);

export function applicationPhotoUrl(key: string): string {
  return new URL(`${uploadsPath}${key}`, env.LOGTO_BASE_URL).href;
}

export function applicationPhotoKey(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    if (!pathname.startsWith(uploadsPath)) return null;
    const key = pathname.slice(uploadsPath.length);
    return isUploadKey(key) ? key : null;
  } catch {
    return null;
  }
}

let service: ReturnType<typeof createApplicationService> | null = null;

export function getApplicationService() {
  service ??= createApplicationService({
    store: createDatabaseApplicationStore(db),
    uploads: uploadStore,
    tekid() {
      if (!env.TEKID_API_KEY) {
        // Approval would otherwise write 'approved' with no credential behind it.
        throw new ApplicationError(503, 'Club ID admin access is not configured, so nothing can be approved yet.');
      }
      return createTekidAdminClient({ baseUrl: env.TEKID_ISSUER, apiKey: env.TEKID_API_KEY });
    },
    allowedEmailDomains: env.MEMBER_EMAIL_DOMAINS,
    memberGroup: env.TEKID_MEMBER_GROUP,
    linkTtl: env.TEKID_LINK_TTL,
    maximumUploadBytes: env.UPLOADS_MAX_BYTES,
    photoUrl: applicationPhotoUrl,
    photoKey: applicationPhotoKey,
  });
  return service;
}
