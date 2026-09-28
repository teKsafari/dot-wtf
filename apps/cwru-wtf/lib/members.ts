import 'server-only';

import { and, asc, count, desc, eq, max, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from './schema';
import { memberAuditLogs, memberships, users } from './schema';
import { findMemberAccessByTekidId, findManagementMemberRecordByTekidId, selectManagementMemberRecords, type MemberRecord } from './member-records';
import { applicationFieldsSchema, safeSocialLinks } from './member-profile-fields';
import {
  assertDashboardPermission, AuthorizationError, dashboardContextForMember,
  type DashboardPermission, type LocalMemberAccess,
} from './authorization';
import {
  memberStatuses, safeMemberPicture,
  type DashboardMember, type DashboardMembersPage, type MemberApplicationFields,
  type MemberStatusFilter,
} from './member-types';
import { TekidProfileContractError } from './tekid/profile';
import type { AuthContextType } from './tekid/types';

export const maximumMemberNumber = 2_147_483_646;
export const memberMutationLockKey = 'dot-wtf:membership';
const pageSize = 20;
const userIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const memberNumberSchema = z.number().int().min(1).max(maximumMemberNumber);
const mutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), memberNumber: memberNumberSchema.optional() }).strict(),
  z.object({ action: z.literal('reject') }).strict(),
  z.object({ action: z.literal('suspend') }).strict(),
  z.object({ action: z.literal('set-number'), memberNumber: memberNumberSchema }).strict(),
  z.object({ action: z.literal('set-role'), role: z.enum(['member', 'instance-lead', 'admin']) }).strict(),
]);

export class MemberError extends Error {
  constructor(public readonly status: 400 | 404 | 409 | 503, message: string) {
    super(message);
    this.name = 'MemberError';
  }
}

export type { MemberRecord } from './member-records';
type MemberChanges = Partial<Pick<MemberRecord,
  'status' | 'role' | 'memberNumber' | 'approvedAt' | 'reviewedAt' | 'reviewedBy' | 'updatedAt'
>>;
export type MemberAudit = {
  actorId: string;
  targetId: string;
  action: string;
  details: Record<string, unknown>;
};

export interface MemberTransaction {
  findMember(userId: string): Promise<MemberRecord | null>;
  findMemberAccess(userId: string): Promise<LocalMemberAccess | null>;
  listMembers(page: number, status: MemberStatusFilter): Promise<MemberRecord[]>;
  countOtherActiveAdmins(userId: string): Promise<number>;
  reserveMemberNumber(requested?: number): Promise<number>;
  updateMember(userId: string, changes: MemberChanges): Promise<MemberRecord>;
  audit(event: MemberAudit): Promise<void>;
}
export interface MemberStore {
  transaction<T>(operation: (transaction: MemberTransaction) => Promise<T>): Promise<T>;
}

function applicationFields(member: MemberRecord): MemberApplicationFields {
  const links = safeSocialLinks(member.socialLinks);
  return {
    name: member.name, institution: member.institution,
    categories: member.categories, otherCategory: member.otherCategory, whatsapp: member.whatsapp,
    bio: member.bio, wtfIdea: member.wtfIdea, currentProject: member.currentProject,
    youtubeLink: member.youtubeLink,
    github: links.github ?? '', instagram: links.instagram ?? '',
    linkedin: links.linkedin ?? '', portfolio: links.portfolio ?? '',
  };
}

export function toDashboardMember(member: MemberRecord): DashboardMember {
  return {
    id: member.tekidUserId,
    name: member.name.trim() || null,
    email: member.email || null,
    picture: safeMemberPicture(member.picture),
    role: member.role,
    status: member.status,
    memberNumber: member.memberNumber,
    submittedAt: member.submittedAt?.toISOString() ?? null,
    approvedAt: member.approvedAt?.toISOString() ?? null,
    fields: applicationFields(member),
  };
}

function parseInput<T extends z.ZodTypeAny>(validator: T, input: unknown): z.infer<T> {
  const parsed = validator.safeParse(input);
  if (!parsed.success) throw new MemberError(400, 'Provide a valid member, action, status, page, and positive member number.');
  return parsed.data;
}

function isNumberConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (typeof error === 'object' && error !== null && !seen.has(error)) {
    seen.add(error);
    if ('code' in error && error.code === '23505') return true;
    error = 'cause' in error ? error.cause : undefined;
  }
  return false;
}

export function createMemberService(dependencies: {
  getAuthContext: () => Promise<AuthContextType>;
  store: MemberStore;
  now?: () => Date;
}) {
  async function requireIdentity() {
    let auth: AuthContextType;
    try {
      auth = await dependencies.getAuthContext();
    } catch (error) {
      if (error instanceof TekidProfileContractError) throw new AuthorizationError(403, 'Complete your tekID profile before using the dashboard.');
      throw error;
    }
    if (!auth.isAuthenticated) throw new AuthorizationError(401);
    return auth;
  }

  async function listMembers(pageInput: unknown = 1, statusInput: unknown = 'all'): Promise<DashboardMembersPage> {
    const auth = await requireIdentity();
    const page = parseInput(z.coerce.number().int().min(1).max(100_000), pageInput);
    const status = parseInput(z.enum(['all', ...memberStatuses]), statusInput);
    return dependencies.store.transaction(async (transaction) => {
      const actor = dashboardContextForMember(auth, await transaction.findMemberAccess(auth.claims.sub));
      assertDashboardPermission(actor, 'members:read');
      const rows = await transaction.listMembers(page, status);
      return { members: rows.slice(0, pageSize).map(toDashboardMember), page, status, hasMore: rows.length > pageSize };
    });
  }

  async function reviewMember(userIdInput: unknown, input: unknown): Promise<DashboardMember> {
    const auth = await requireIdentity();
    const userId = parseInput(userIdSchema, userIdInput);
    const mutation = parseInput(mutationSchema, input);
    try {
      return await dependencies.store.transaction(async (transaction) => {
        // All membership writes share this lock. Re-read the actor after acquiring it:
        // a queued request cannot retain privileges revoked by the preceding mutation.
        const actor = dashboardContextForMember(auth, await transaction.findMemberAccess(auth.claims.sub));
        const permission: DashboardPermission = mutation.action === 'set-role' ? 'members:assign-roles'
          : mutation.action === 'set-number' || (mutation.action === 'approve' && mutation.memberNumber !== undefined)
            ? 'members:renumber' : 'members:review';
        assertDashboardPermission(actor, permission);
        const member = await transaction.findMember(userId);
        if (!member) throw new MemberError(404, 'This member profile no longer exists.');
        if (member.role !== 'member' && actor.role !== 'admin') throw new AuthorizationError(403, 'Only administrators can review staff accounts.');

        const now = dependencies.now?.() ?? new Date();
        const changes: MemberChanges = { updatedAt: now };
        switch (mutation.action) {
          case 'approve': {
            if (!['pending', 'rejected', 'suspended'].includes(member.status)) {
              throw new MemberError(409, member.status === 'draft' ? 'This person must submit their application before approval.' : 'This member is already approved.');
            }
            if (!member.emailVerified) throw new MemberError(409, 'This person must verify their email before approval.');
            const returningMember = member.status === 'suspended' && member.memberNumber !== null && member.approvedAt !== null;
            if (!returningMember && (!member.submittedAt || !applicationFieldsSchema.safeParse(applicationFields(member)).success)) {
              throw new MemberError(409, 'This application is incomplete. Ask the applicant to complete it and submit again.');
            }
            changes.memberNumber = mutation.memberNumber !== undefined && mutation.memberNumber !== member.memberNumber
              ? await transaction.reserveMemberNumber(mutation.memberNumber)
              : member.memberNumber ?? await transaction.reserveMemberNumber();
            changes.status = 'approved';
            changes.approvedAt = member.approvedAt ?? now;
            break;
          }
          case 'reject': {
            if (member.status !== 'pending') throw new MemberError(409, 'Only a pending application can be rejected.');
            changes.status = 'rejected';
            break;
          }
          case 'suspend': {
            if (member.status !== 'approved') throw new MemberError(409, 'Only an approved member can be suspended.');
            if (userId === auth.claims.sub) throw new MemberError(409, 'Ask another administrator to suspend your account.');
            changes.status = 'suspended';
            break;
          }
          case 'set-number': {
            if (member.memberNumber === null) throw new MemberError(409, 'Approve this application before assigning a member number.');
            changes.memberNumber = mutation.memberNumber === member.memberNumber
              ? member.memberNumber : await transaction.reserveMemberNumber(mutation.memberNumber);
            break;
          }
          case 'set-role': {
            const revokeSuspendedRole = member.status === 'suspended' && mutation.role === 'member' && member.role !== 'member';
            if (member.status !== 'approved' && !revokeSuspendedRole) {
              throw new MemberError(409, 'Approve this member before granting a role. Suspended staff roles can only be removed.');
            }
            if (userId === auth.claims.sub && mutation.role !== 'admin') throw new MemberError(409, 'Ask another administrator to change your administrator role.');
            changes.role = mutation.role;
            break;
          }
        }

        if (member.status === 'approved' && member.role === 'admin' &&
            ((changes.status && changes.status !== 'approved') || (changes.role && changes.role !== 'admin')) &&
            await transaction.countOtherActiveAdmins(userId) === 0) {
          throw new MemberError(409, 'Keep at least one active administrator.');
        }
        if (changes.status) {
          changes.reviewedAt = now;
          changes.reviewedBy = auth.claims.sub;
        }
        const updated = await transaction.updateMember(userId, changes);
        await transaction.audit({
          actorId: auth.claims.sub, targetId: userId, action: `member.${mutation.action}`,
          details: {
            before: { status: member.status, role: member.role, memberNumber: member.memberNumber },
            after: { status: updated.status, role: updated.role, memberNumber: updated.memberNumber },
          },
        });
        return toDashboardMember(updated);
      });
    } catch (error) {
      if (isNumberConflict(error)) throw new MemberError(409, 'That member number is already assigned. Choose another number.');
      throw error;
    }
  }

  return { listMembers, reviewMember };
}

export type MembershipDatabase = PostgresJsDatabase<typeof schema>;
export type MembershipTransactionDatabase = Parameters<Parameters<MembershipDatabase['transaction']>[0]>[0];

export function withMemberMutationLock<T>(database: MembershipDatabase, operation: (transaction: MembershipTransactionDatabase) => Promise<T>): Promise<T> {
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${memberMutationLockKey}, 0))`);
    return operation(transaction);
  });
}

// Call these helpers under withMemberMutationLock. PostgreSQL sequences do not
// roll back with a failed membership transaction: gaps are expected and automatic allocation never rewinds.
async function memberNumberState(transaction: MembershipTransactionDatabase) {
  const [sequence] = await transaction.execute<{ lastValue: string; isCalled: boolean }>(
    sql`select last_value::text as "lastValue", is_called as "isCalled" from member_number_seq`
  );
  const [maximum] = await transaction.select({ value: max(memberships.memberNumber) }).from(memberships);
  const sequenceNext = Number(sequence!.lastValue) + (sequence!.isCalled ? 1 : 0);
  return { sequenceNext, nextNumber: Math.max(sequenceNext, (maximum?.value ?? 0) + 1) };
}

// Read-only prediction for operator dry runs; does not call nextval or setval.
export async function peekNextMemberNumber(transaction: MembershipTransactionDatabase): Promise<number> {
  return (await memberNumberState(transaction)).nextNumber;
}

export async function reserveMemberNumber(transaction: MembershipTransactionDatabase, requested?: number): Promise<number> {
  if (requested !== undefined && !memberNumberSchema.safeParse(requested).success) {
    throw new MemberError(400, `Choose a whole member number between 1 and ${maximumMemberNumber}.`);
  }
  if (requested !== undefined) {
    const [collision] = await transaction.select({ id: memberships.id }).from(memberships)
      .where(eq(memberships.memberNumber, requested)).limit(1);
    if (collision) throw new MemberError(409, 'That member number is already assigned. Choose another number.');
  }
  const { sequenceNext, nextNumber } = await memberNumberState(transaction);
  if (requested !== undefined) {
    const followingNumber = Math.max(nextNumber, requested + 1);
    if (sequenceNext < followingNumber) {
      await transaction.execute(sql`select setval('member_number_seq', ${followingNumber}, false)`);
    }
    return requested;
  }
  if (nextNumber > maximumMemberNumber) {
    throw new MemberError(409, 'Automatic member numbers are exhausted. An administrator must choose an available number.');
  }
  // A legacy bridge or operator may have inserted a number above the sequence.
  // Only advance the sequence; even rolled-back reservations retain their high water mark.
  if (sequenceNext < nextNumber) {
    await transaction.execute(sql`select setval('member_number_seq', ${nextNumber}, false)`);
  }
  const [allocated] = await transaction.execute<{ number: string }>(sql`select nextval('member_number_seq')::text as number`);
  const number = Number(allocated!.number);
  if (number > maximumMemberNumber) throw new MemberError(409, 'Automatic member numbers are exhausted.');
  return number;
}

export function createDatabaseMemberStore(database: MembershipDatabase): MemberStore {
  return {
    transaction(operation) {
      return withMemberMutationLock(database, (transaction) => operation({
        async findMemberAccess(userId) {
          return findMemberAccessByTekidId(transaction, userId);
        },
        async findMember(userId) {
          return findManagementMemberRecordByTekidId(transaction, userId);
        },
        async listMembers(page, status) {
          return selectManagementMemberRecords(transaction)
            .where(status === 'all' ? undefined : eq(memberships.status, status))
            .orderBy(desc(memberships.submittedAt), desc(memberships.createdAt), asc(users.tekidUserId))
            .limit(pageSize + 1).offset((page - 1) * pageSize);
        },
        async countOtherActiveAdmins(userId) {
          const [result] = await transaction.select({ value: count() }).from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.status, 'approved'), eq(memberships.role, 'admin'), ne(users.tekidUserId, userId)));
          return result?.value ?? 0;
        },
        async reserveMemberNumber(requested) {
          return reserveMemberNumber(transaction, requested);
        },
        async updateMember(userId, changes) {
          const member = await findManagementMemberRecordByTekidId(transaction, userId);
          if (!member) throw new MemberError(404, 'This member profile no longer exists.');
          await transaction.update(memberships).set(changes).where(eq(memberships.id, member.membershipId));
          return (await findManagementMemberRecordByTekidId(transaction, userId))!;
        },
        async audit(event) {
          await transaction.insert(memberAuditLogs).values(event);
        },
      }));
    },
  };
}

async function getMemberService() {
  const [{ db }, { getTekidAuthContext }] = await Promise.all([import('./db'), import('./tekid/server')]);
  return createMemberService({ getAuthContext: getTekidAuthContext, store: createDatabaseMemberStore(db) });
}

export async function listDashboardMembers(page: unknown = 1, status: unknown = 'all') {
  return (await getMemberService()).listMembers(page, status);
}
export async function reviewDashboardMember(userId: unknown, input: unknown) {
  return (await getMemberService()).reviewMember(userId, input);
}
