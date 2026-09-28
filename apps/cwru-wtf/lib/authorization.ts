import 'server-only';

import { eq } from 'drizzle-orm';
import { memberProfiles } from './schema';
import { TekidProfileContractError } from './tekid/profile';
import type { AuthContextType, AuthSession } from './tekid/types';
import type { MemberRole, MemberStatus } from './member-types';

export const dashboardPermissions = [
  'dashboard:access', 'submissions:read', 'submissions:manage',
  'members:read', 'members:review', 'members:renumber', 'members:assign-roles',
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
export type LocalMemberAccess = { status: MemberStatus; role: MemberRole };

export class AuthorizationError extends Error {
  constructor(public readonly status: 401 | 403 | 503, message?: string) {
    super(message ?? {
      401: 'Sign in with tekID to continue.',
      403: 'You do not have permission to perform this action.',
      503: 'Membership permissions are temporarily unavailable. Please try again.',
    }[status]);
    this.name = 'AuthorizationError';
  }
}

export function dashboardContextForMember(
  auth: Extract<AuthContextType, { isAuthenticated: true }>,
  member: LocalMemberAccess | null
): AuthenticatedDashboardContext {
  const role = member?.status === 'approved' && (member.role === 'admin' || member.role === 'instance-lead')
    ? member.role : null;
  return {
    ...auth,
    role,
    canAccessDashboard: role !== null,
    permissions: role === null ? [] : dashboardPermissions.filter((permission) =>
      role === 'admin' || !['members:renumber', 'members:assign-roles'].includes(permission)
    ),
  };
}

export function assertDashboardPermission(
  context: DashboardAuthContext,
  permission: DashboardPermission
): asserts context is AuthenticatedDashboardContext {
  if (!context.isAuthenticated) throw new AuthorizationError(401);
  if (!context.canAccessDashboard || !context.permissions.includes(permission)) throw new AuthorizationError(403);
}

export function createDashboardAuthorization(dependencies: {
  getAuthContext: () => Promise<AuthContextType>;
  findMember: (userId: string) => Promise<LocalMemberAccess | null>;
}) {
  async function getDashboardAuthContext(): Promise<DashboardAuthContext> {
    const auth = await dependencies.getAuthContext();
    if (!auth.isAuthenticated) return { isAuthenticated: false };
    try {
      return dashboardContextForMember(auth, await dependencies.findMember(auth.claims.sub));
    } catch {
      // A failed lookup must not grant access from a previous request or token role claim.
      throw new AuthorizationError(503);
    }
  }

  async function requireDashboardPermission(permission: DashboardPermission) {
    let context: DashboardAuthContext;
    try {
      context = await getDashboardAuthContext();
    } catch (error) {
      if (error instanceof TekidProfileContractError) {
        throw new AuthorizationError(403, 'Complete your tekID profile before using the dashboard.');
      }
      throw error;
    }
    assertDashboardPermission(context, permission);
    return context;
  }

  return { getDashboardAuthContext, requireDashboardPermission };
}

async function getAuthorization() {
  const { getTekidAuthContext } = await import('./tekid/server');
  return createDashboardAuthorization({
    getAuthContext: getTekidAuthContext,
    async findMember(userId) {
      const { db } = await import('./db');
      const [member] = await db.select({ status: memberProfiles.status, role: memberProfiles.role })
        .from(memberProfiles).where(eq(memberProfiles.tekidUserId, userId)).limit(1);
      return member ?? null;
    },
  });
}

export async function getDashboardAuthContext(): Promise<DashboardAuthContext> {
  return (await getAuthorization()).getDashboardAuthContext();
}

export async function requireDashboardPermission(permission: DashboardPermission) {
  return (await getAuthorization()).requireDashboardPermission(permission);
}
