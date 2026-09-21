import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  organizationRolesSchema,
  requireDashboardPermission,
  roleFromIds,
  TekidAuthorizationError,
  type AuthenticatedDashboardContext,
  type DashboardPermission,
} from './authorization';
import {
  getTekidManagementClient,
  getTekidOrganizationConfig,
  TekidManagementError,
  type TekidManagementClient,
  type TekidOrganizationConfig,
} from './management';
import type { DashboardMember, DashboardMembersPage } from './member-types';
import { listAllManagementItems } from './pagination';

const pageSize = 20;
const userIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/).max(128);
const memberRoleSchema = z.enum(['member', 'admin', 'instance-lead']);
const addMemberSchema = z.object({
  email: z.string().trim().email().max(128),
  role: memberRoleSchema,
}).strict();
const updateRoleSchema = z.object({ role: memberRoleSchema }).strict();
const userSchema = z.object({
  id: userIdSchema,
  name: z.string().nullable(),
  primaryEmail: z.string().nullable(),
  avatar: z.string().nullable(),
  isSuspended: z.boolean(),
});
const memberSchema = userSchema.extend({ organizationRoles: organizationRolesSchema });

export class TekidMemberError extends Error {
  constructor(public readonly status: 400 | 404 | 409 | 503, message: string) {
    super(message);
    this.name = 'TekidMemberError';
  }
}

function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new TekidMemberError(400, 'Provide a valid email or member ID and supported role.');
  return result.data;
}

function safePicture(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

type MutationAudit = {
  action: 'member.add' | 'member.role.update';
  actorId: string;
  targetId: string;
  organizationId: string;
  beforeRoleIds: string[];
  afterRoleIds: string[];
};

export function createMemberService(dependencies: {
  management: TekidManagementClient;
  organization: TekidOrganizationConfig;
  requirePermission: (permission: DashboardPermission) => Promise<AuthenticatedDashboardContext>;
  withMutationLock: <T>(operation: () => Promise<T>) => Promise<T>;
  audit: (event: MutationAudit) => void;
}) {
  const config = dependencies.organization;
  const orgPath = `/api/organizations/${encodeURIComponent(config.organizationId)}`;
  const rolePath = (userId: string) => `${orgPath}/users/${encodeURIComponent(userId)}/roles`;

  function toMember(user: z.infer<typeof userSchema>, roleIds: string[]): DashboardMember {
    return {
      id: user.id,
      name: user.name,
      email: user.primaryEmail,
      picture: safePicture(user.avatar),
      role: roleFromIds(roleIds, config) ?? 'member',
    };
  }

  async function getMemberRoleIds(userId: string): Promise<string[] | null> {
    try {
      const roles = await listAllManagementItems(
        dependencies.management,
        rolePath(userId),
        (data) => organizationRolesSchema.parse(data)
      );
      return roles.map(({ id }) => id);
    } catch (error) {
      if (error instanceof TekidManagementError && [404, 422].includes(error.status)) return null;
      throw error;
    }
  }

  async function requireRoleAssignment() {
    const actor = await dependencies.requirePermission('members:assign-roles');
    if (actor.role !== 'admin') throw new TekidAuthorizationError(403);
    return actor;
  }

  async function listMembers(pageInput: unknown = 1): Promise<DashboardMembersPage> {
    await dependencies.requirePermission('members:read');
    const page = parseInput(z.coerce.number().int().min(1).max(100_000), pageInput);
    const response = await dependencies.management.request('GET', `${orgPath}/users`, {
      query: { page: String(page), page_size: String(pageSize) },
    });
    const users = z.array(memberSchema).parse(response.data);
    const totalHeader = response.headers.get('total-number');
    const total = totalHeader === null ? NaN : Number(totalHeader);
    return {
      members: users.map((user) => toMember(user, user.organizationRoles.map(({ id }) => id))),
      page,
      hasMore: Number.isFinite(total) ? page * pageSize < total : users.length === pageSize,
    };
  }

  async function addMember(input: unknown): Promise<DashboardMember> {
    const { email, role } = parseInput(addMemberSchema, input);
    await dependencies.requirePermission('members:invite');
    if (role !== 'member') await requireRoleAssignment();

    return dependencies.withMutationLock(async () => {
      // Recheck after acquiring the shared lock so an in-flight demotion takes effect.
      let actor = await dependencies.requirePermission('members:invite');
      if (role !== 'member') actor = await requireRoleAssignment();
      const response = await dependencies.management.request('GET', '/api/users', {
        query: {
          'search.primaryEmail': email,
          'mode.primaryEmail': 'exact',
          isCaseSensitive: 'false',
          page: '1',
          page_size: '2',
        },
      });
      const users = z.array(userSchema).parse(response.data);
      const user = users[0];
      if (users.length !== 1 || user.primaryEmail?.toLowerCase() !== email.toLowerCase()) {
        throw new TekidMemberError(404, 'No unique tekID account matches that email. Ask them to create a tekID profile first.');
      }
      if (user.isSuspended) throw new TekidMemberError(409, 'This tekID account is suspended.');
      if (await getMemberRoleIds(user.id) !== null) {
        throw new TekidMemberError(409, 'This person is already a member. Update their role in the member list.');
      }

      await dependencies.management.request('POST', `${orgPath}/users`, { body: { userIds: [user.id] } });
      const roleIds = role === 'member' ? [] : [role === 'admin' ? config.adminRoleId : config.instanceLeadRoleId];
      if (roleIds.length > 0) {
        try {
          await dependencies.management.request('POST', rolePath(user.id), {
            body: { organizationRoleIds: roleIds },
          });
        } catch {
          // Membership and role assignment are separate Logto operations.
          dependencies.audit({ action: 'member.add', actorId: actor.claims.sub, targetId: user.id,
            organizationId: config.organizationId, beforeRoleIds: [], afterRoleIds: [] });
          throw new TekidMemberError(503, 'The member was added, but their role could not be assigned. Refresh the member list and try updating their role.');
        }
      }
      dependencies.audit({ action: 'member.add', actorId: actor.claims.sub, targetId: user.id,
        organizationId: config.organizationId, beforeRoleIds: [], afterRoleIds: roleIds });
      return toMember(user, roleIds);
    });
  }

  async function updateMemberRole(userIdInput: unknown, input: unknown): Promise<DashboardMember> {
    const userId = parseInput(userIdSchema, userIdInput);
    const { role } = parseInput(updateRoleSchema, input);
    await requireRoleAssignment();

    return dependencies.withMutationLock(async () => {
      const actor = await requireRoleAssignment();
      const currentRoleIds = await getMemberRoleIds(userId);
      if (currentRoleIds === null) throw new TekidMemberError(404, 'This person is not a member of this instance.');
      if (actor.claims.sub === userId && role !== 'admin') {
        throw new TekidMemberError(409, 'Ask another admin to change your administrator role.');
      }
      if (currentRoleIds.includes(config.adminRoleId) && role !== 'admin') {
        const admins = await listAllManagementItems(
          dependencies.management,
          `${orgPath}/users`,
          (data) => z.array(memberSchema).parse(data),
          { organizationRoleId: config.adminRoleId }
        );
        if (!admins.some((admin) => admin.id !== userId && !admin.isSuspended)) {
          throw new TekidMemberError(409, 'Keep at least one active admin for this instance.');
        }
      }

      const userResponse = await dependencies.management.request('GET', `/api/users/${encodeURIComponent(userId)}`);
      const user = userSchema.parse(userResponse.data);
      if (user.isSuspended && role !== 'member') {
        throw new TekidMemberError(409, 'Elevated roles cannot be assigned to a suspended account.');
      }
      const nextRoleIds = currentRoleIds.filter((id) => id !== config.adminRoleId && id !== config.instanceLeadRoleId);
      if (role !== 'member') nextRoleIds.push(role === 'admin' ? config.adminRoleId : config.instanceLeadRoleId);
      await dependencies.management.request('PUT', rolePath(userId), {
        body: { organizationRoleIds: [...new Set(nextRoleIds)] },
      });
      dependencies.audit({ action: 'member.role.update', actorId: actor.claims.sub, targetId: userId,
        organizationId: config.organizationId, beforeRoleIds: currentRoleIds, afterRoleIds: nextRoleIds });
      return toMember(user, nextRoleIds);
    });
  }

  return { listMembers, addMember, updateMemberRole };
}

function getMemberService() {
  const organization = getTekidOrganizationConfig();
  return createMemberService({
    management: getTekidManagementClient(),
    organization,
    requirePermission: requireDashboardPermission,
    async withMutationLock(operation) {
      const { db } = await import('@/lib/db');
      return db.transaction(async (transaction) => {
        // Serialize role edits across deployments, not just this server process.
        await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tekid-members:${organization.organizationId}`}, 0))`);
        return operation();
      });
    },
    audit(event) {
      console.info('tekID membership change', { ...event, at: new Date().toISOString() });
    },
  });
}

export const listDashboardMembers = (page: unknown = 1) => getMemberService().listMembers(page);
export const addDashboardMember = (input: unknown) => getMemberService().addMember(input);
export const updateDashboardMemberRole = (userId: unknown, input: unknown) =>
  getMemberService().updateMemberRole(userId, input);
