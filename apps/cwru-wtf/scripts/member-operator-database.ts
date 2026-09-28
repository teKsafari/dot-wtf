import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import * as schema from '../lib/schema';
import { memberAuditLogs, memberships, profiles, users } from '../lib/schema';
import { maximumMemberNumber, peekNextMemberNumber, reserveMemberNumber, withMemberMutationLock, type MembershipDatabase } from '../lib/members';
import { selectMemberRecords } from '../lib/member-records';
import { safeMemberPicture } from '../lib/member-types';
import {
  bootstrapActor, importActor, importAuditAction, OperatorError, planBootstrap, planLegacyImport,
  type LegacyMember,
} from './member-operator-logic';

export function openOperatorDatabase(value: string | undefined) {
  const parsed = z.string().url().refine((url) => ['postgres:', 'postgresql:'].includes(new URL(url).protocol)).safeParse(value);
  if (!parsed.success) throw new OperatorError('Invalid environment variable: DATABASE_URL');
  const client = postgres(parsed.data, { max: 1, connect_timeout: 10 });
  return { database: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

export async function bootstrapLocalMember(database: MembershipDatabase, input: {
  email?: string; userId?: string; role: 'admin' | 'instance-lead'; dryRun: boolean;
}) {
  return withMemberMutationLock(database, async (transaction) => {
    const records = await selectMemberRecords(transaction).where(input.userId
      ? eq(users.tekidUserId, input.userId)
      : sql`lower(${users.email}) = ${input.email}`).limit(2);
    const { profile, unchanged } = planBootstrap(records, input.role);
    if (input.dryRun || unchanged) return { userId: profile.tekidUserId, number: profile.memberNumber, unchanged, dryRun: input.dryRun };
    const now = new Date();
    const number = profile.memberNumber ?? await reserveMemberNumber(transaction);
    const [saved] = await transaction.update(memberships).set({
      status: 'approved', role: input.role, memberNumber: number,
      approvedAt: profile.approvedAt ?? now, reviewedAt: now, reviewedBy: bootstrapActor, updatedAt: now,
    }).where(eq(memberships.userId, records[0]!.userId)).returning();
    await transaction.insert(memberAuditLogs).values({
      actorId: bootstrapActor, targetId: profile.tekidUserId, action: 'member.bootstrap',
      details: { before: { status: profile.status, role: profile.role }, after: { status: saved!.status, role: saved!.role, memberNumber: number } },
    });
    return { userId: profile.tekidUserId, number, unchanged: false, dryRun: false };
  });
}

export async function importLegacyMembers(database: MembershipDatabase, input: {
  members: LegacyMember[]; organizationId: string; adminRoleId: string; instanceLeadRoleId: string; apply: boolean;
}) {
  return withMemberMutationLock(database, async (transaction) => {
    const ids = input.members.map(({ id }) => id);
    if (!ids.length) return [];
    // An account can exist before its profile. Still honor any local membership decision.
    const rows = await transaction.select({ user: users, profile: profiles, membership: memberships })
      .from(users).leftJoin(profiles, eq(profiles.userId, users.id))
      .leftJoin(memberships, eq(memberships.userId, users.id)).where(inArray(users.tekidUserId, ids));
    const existingProfiles = rows.map(({ user, profile, membership }) => ({
      tekidUserId: user.tekidUserId, name: profile?.name ?? '', email: user.email, emailVerified: user.emailVerified,
      role: membership?.role ?? 'member' as const, status: membership?.status ?? 'draft' as const,
      memberNumber: membership?.memberNumber ?? null, approvedAt: membership?.approvedAt ?? null,
      reviewedAt: membership?.reviewedAt ?? null, reviewedBy: membership?.reviewedBy ?? null,
    }));
    const existingUsers = new Map(rows.map(({ user }) => [user.tekidUserId, user]));
    const priorDecisions = await transaction.select({ targetId: memberAuditLogs.targetId, action: memberAuditLogs.action })
      .from(memberAuditLogs).where(and(inArray(memberAuditLogs.targetId, ids), like(memberAuditLogs.action, 'member.%')));
    const plan = planLegacyImport({ ...input, profiles: existingProfiles, priorDecisions });
    let nextNumber = await peekNextMemberNumber(transaction);
    const toImport = plan.filter(({ outcome }) => outcome === 'import').length;
    if (toImport && nextNumber + toImport - 1 > maximumMemberNumber) {
      throw new OperatorError('Not enough automatic member numbers remain for this import.');
    }
    const now = new Date();
    const results = [];
    for (const decision of plan) {
      let number = decision.existing?.memberNumber ?? null;
      if (decision.outcome === 'import') {
        number = input.apply ? await reserveMemberNumber(transaction) : nextNumber;
        nextNumber = number + 1;
        if (input.apply) {
          const existingUser = existingUsers.get(decision.member.id);
          const identity = {
            email: decision.member.primaryEmail ?? '',
            // A Management API snapshot cannot establish email verification.
            emailVerified: Boolean(existingUser?.emailVerified && existingUser.email.toLowerCase() === decision.member.primaryEmail?.toLowerCase()),
            updatedAt: now,
          };
          const [user] = existingUser
            ? await transaction.update(users).set(identity).where(eq(users.id, existingUser.id)).returning()
            : await transaction.insert(users).values({ tekidUserId: decision.member.id, ...identity }).returning();
          await transaction.insert(profiles).values({
            userId: user!.id, name: decision.member.name?.trim() || '',
            picture: safeMemberPicture(decision.member.avatar), updatedAt: now,
          }).onConflictDoUpdate({ target: profiles.userId, set: {
            name: sql`case when btrim(${profiles.name}) <> '' then ${profiles.name} else excluded.name end`,
            picture: safeMemberPicture(decision.member.avatar), updatedAt: now,
          } });
          const membership = {
            status: decision.status, role: decision.role, memberNumber: number,
            approvedAt: decision.member.joinedAt == null ? now : new Date(decision.member.joinedAt),
            reviewedAt: now, reviewedBy: importActor, updatedAt: now,
          };
          await transaction.insert(memberships).values({ userId: user!.id, ...membership })
            .onConflictDoUpdate({ target: memberships.userId, set: membership });
        }
      }
      if (input.apply && decision.outcome !== 'already-imported') {
        // External identity markers survive account deletion and preserve migration idempotence.
        await transaction.insert(memberAuditLogs).values({
          actorId: importActor, targetId: decision.member.id, action: importAuditAction,
          details: { organizationId: input.organizationId, outcome: decision.outcome, role: decision.role, status: decision.status,
            memberNumber: number, orderingSource: decision.orderingSource, orderingTime: decision.orderingTime },
        });
      }
      results.push({ userId: decision.member.id, outcome: decision.outcome,
        role: decision.outcome === 'import' ? decision.role : decision.existing?.role ?? null,
        status: decision.outcome === 'import' ? decision.status : decision.existing?.status ?? null,
        memberNumber: number, orderingSource: decision.orderingSource });
    }
    return results;
  });
}
