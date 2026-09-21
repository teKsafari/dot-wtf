import 'server-only';

import { z } from 'zod';
import { TekidProfileContractError } from './profile';
import {
  getTekidManagementClient,
  getTekidOrganizationConfig,
  TekidManagementError,
  type TekidManagementClient,
  type TekidOrganizationConfig,
} from './management';
import type { AuthContextType, AuthSession } from './types';
import { listAllManagementItems } from './pagination';

export const dashboardPermissions = [
  'dashboard:access',
  'submissions:read',
  'submissions:manage',
  'members:read',
  'members:invite',
  'members:assign-roles',
] as const;

export type DashboardPermission = typeof dashboardPermissions[number];
export type DashboardRole = 'admin' | 'instance-lead';
export type DashboardAuthContext =
  | { isAuthenticated: false }
  | {
      isAuthenticated: true;
      canAccessDashboard: boolean;
      claims: AuthSession;
      role: DashboardRole | null;
      permissions: string[];
    };
export type AuthenticatedDashboardContext = Extract<DashboardAuthContext, { isAuthenticated: true }>;

export class TekidAuthorizationError extends Error {
  constructor(public readonly status: 401 | 403 | 503, message?: string) {
    super(message ?? {
      401: 'Sign in with tekID to continue.',
      403: 'You do not have permission to perform this action.',
      503: 'tekID permissions are temporarily unavailable. Please try again.',
    }[status]);
    this.name = 'TekidAuthorizationError';
  }
}

const scopesSchema = z.array(z.object({ name: z.string() }));
export const organizationRolesSchema = z.array(z.object({ id: z.string().min(1) }));

export function roleFromIds(ids: string[], config: TekidOrganizationConfig): DashboardRole | null {
  if (ids.includes(config.adminRoleId)) return 'admin';
  if (ids.includes(config.instanceLeadRoleId)) return 'instance-lead';
  return null;
}

export function createDashboardAuthorization(dependencies: {
  getAuthContext: () => Promise<AuthContextType>;
  management: TekidManagementClient;
  organization: TekidOrganizationConfig;
}) {
  async function getDashboardAuthContext(): Promise<DashboardAuthContext> {
    const auth = await dependencies.getAuthContext();
    if (!auth.isAuthenticated) return { isAuthenticated: false };

    const denied: AuthenticatedDashboardContext = {
      ...auth, canAccessDashboard: false, role: null, permissions: [],
    };
    const org = encodeURIComponent(dependencies.organization.organizationId);
    const user = encodeURIComponent(auth.claims.sub);

    try {
      const [scopes, roles, account] = await Promise.all([
        dependencies.management.request('GET', `/api/organizations/${org}/users/${user}/scopes`),
        listAllManagementItems(
          dependencies.management,
          `/api/organizations/${org}/users/${user}/roles`,
          (data) => organizationRolesSchema.parse(data)
        ),
        dependencies.management.request('GET', `/api/users/${user}`),
      ]);
      if (z.object({ isSuspended: z.boolean() }).parse(account.data).isSuspended) return denied;

      const role = roleFromIds(
        roles.map(({ id }) => id),
        dependencies.organization
      );
      if (!role) return denied;
      const currentScopes = new Set(scopesSchema.parse(scopes.data).map(({ name }) => name));
      const permissions = dashboardPermissions.filter((permission) =>
        currentScopes.has(permission) && (permission !== 'members:assign-roles' || role === 'admin')
      );
      return {
        ...auth,
        role,
        permissions,
        canAccessDashboard: permissions.includes('dashboard:access'),
      };
    } catch (error) {
      if (error instanceof TekidManagementError && [404, 422].includes(error.status)) return denied;
      throw new TekidAuthorizationError(503);
    }
  }

  async function requireDashboardPermission(permission: DashboardPermission) {
    let context: DashboardAuthContext;
    try {
      context = await getDashboardAuthContext();
    } catch (error) {
      if (error instanceof TekidProfileContractError) {
        throw new TekidAuthorizationError(403, 'Complete your tekID profile before using the dashboard.');
      }
      throw error;
    }
    if (!context.isAuthenticated) throw new TekidAuthorizationError(401);
    if (!context.canAccessDashboard || !context.permissions.includes(permission)) {
      throw new TekidAuthorizationError(403);
    }
    return context;
  }

  return { getDashboardAuthContext, requireDashboardPermission };
}

async function getAuthorization() {
  const { getTekidAuthContext } = await import('./server');
  return createDashboardAuthorization({
    getAuthContext: getTekidAuthContext,
    management: getTekidManagementClient(),
    organization: getTekidOrganizationConfig(),
  });
}

export async function getDashboardAuthContext(): Promise<DashboardAuthContext> {
  return (await getAuthorization()).getDashboardAuthContext();
}

export async function requireDashboardPermission(permission: DashboardPermission) {
  return (await getAuthorization()).requireDashboardPermission(permission);
}
