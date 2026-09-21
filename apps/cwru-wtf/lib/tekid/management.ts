import 'server-only';

import { createManagementApi } from '@logto/api/management';
import { env } from '@/env';
import { getTekidConfig } from './config';

export interface TekidOrganizationConfig {
  organizationId: string;
  adminRoleId: string;
  instanceLeadRoleId: string;
}

export function getTekidOrganizationConfig(): TekidOrganizationConfig {
  return {
    organizationId: env.LOGTO_ORGANIZATION_ID,
    adminRoleId: env.LOGTO_ADMIN_ROLE_ID,
    instanceLeadRoleId: env.LOGTO_INSTANCE_LEAD_ROLE_ID,
  };
}

export class TekidManagementError extends Error {
  constructor(public readonly status: number) {
    super('tekID management request failed');
    this.name = 'TekidManagementError';
  }
}

export interface ManagementResponse {
  data: unknown;
  headers: Headers;
}

export interface TekidManagementClient {
  request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    options?: { query?: Record<string, string>; body?: unknown }
  ): Promise<ManagementResponse>;
}

export function createTekidManagementClient(dependencies: {
  endpoint: string;
  getAccessToken: () => Promise<{ value: string }>;
  fetch: typeof fetch;
}): TekidManagementClient {
  const endpoint = new URL(dependencies.endpoint).origin;
  return {
    async request(method, path, options = {}) {
      const url = new URL(path, endpoint);
      if (!path.startsWith('/api/') || url.origin !== new URL(endpoint).origin) {
        throw new Error('Invalid tekID management API path');
      }
      for (const [key, value] of Object.entries(options.query ?? {})) {
        url.searchParams.set(key, value);
      }

      // Only the service credential is cached; authorization data is always fresh.
      const { value: token } = await dependencies.getAccessToken();
      const response = await dependencies.fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new TekidManagementError(response.status);
      let data: unknown;
      if (response.status !== 204) {
        const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (contentType === 'application/json') {
          data = await response.json();
        } else {
          // Logto OSS acknowledges some successful mutations with plain "Created".
          await response.text();
        }
      }
      return {
        data,
        headers: response.headers,
      };
    },
  };
}

let managementClient: TekidManagementClient | undefined;

export function getTekidManagementClient(): TekidManagementClient {
  if (managementClient) return managementClient;

  const endpoint = new URL(getTekidConfig().endpoint).origin;
  const { clientCredentials } = createManagementApi('default', {
    clientId: env.LOGTO_MANAGEMENT_APP_ID,
    clientSecret: env.LOGTO_MANAGEMENT_APP_SECRET,
    baseUrl: endpoint,
    apiIndicator: 'https://default.logto.app/api',
  });
  managementClient = createTekidManagementClient({
    endpoint,
    getAccessToken: () => clientCredentials.getAccessToken(),
    fetch,
  });
  return managementClient;
}
