import { and, eq, inArray, like, max, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import * as schema from '../lib/schema';
import { memberAuditLogs, memberNumberCounter, memberProfiles } from '../lib/schema';
import { maximumMemberNumber, reserveMemberNumber, withMemberMutationLock, type MembershipDatabase } from '../lib/members';
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
    const profileQuery = transaction.select().from(memberProfiles).where(input.userId
      ? eq(memberProfiles.tekidUserId, input.userId)
      : sql`lower(${memberProfiles.email}) = ${input.email}`).limit(2);
    const profiles = input.dryRun ? await profileQuery : await profileQuery.for('update');
    const { profile, unchanged } = planBootstrap(profiles, input.role);
    if (input.dryRun || unchanged) return { userId: profile.tekidUserId, number: profile.memberNumber, unchanged, dryRun: input.dryRun };
    const now = new Date();
    const number = profile.memberNumber ?? await reserveMemberNumber(transaction);
    const [saved] = await transaction.update(memberProfiles).set({
      status: 'approved', role: input.role, memberNumber: number,
      approvedAt: profile.approvedAt ?? now, reviewedAt: now, reviewedBy: bootstrapActor, updatedAt: now,
    }).where(eq(memberProfiles.tekidUserId, profile.tekidUserId)).returning();
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
    const profileQuery = transaction.select().from(memberProfiles).where(inArray(memberProfiles.tekidUserId, ids));
    const profiles = input.apply ? await profileQuery.for('update') : await profileQuery;
    const priorDecisions = await transaction.select({ targetId: memberAuditLogs.targetId, action: memberAuditLogs.action })
      .from(memberAuditLogs).where(and(inArray(memberAuditLogs.targetId, ids), like(memberAuditLogs.action, 'member.%')));
    const plan = planLegacyImport({ ...input, profiles, priorDecisions });
    const [counter] = await transaction.select().from(memberNumberCounter).where(eq(memberNumberCounter.id, 1));
    const [maximum] = await transaction.select({ value: max(memberProfiles.memberNumber) }).from(memberProfiles);
    let nextNumber = Math.max(counter?.nextNumber ?? 1, (maximum?.value ?? 0) + 1);
    const now = new Date();
    const results = [];
    for (const decision of plan) {
      let number = decision.existing?.memberNumber ?? null;
      if (decision.outcome === 'import') {
        if (nextNumber > maximumMemberNumber) throw new OperatorError('Not enough automatic member numbers remain for this import.');
        number = input.apply ? await reserveMemberNumber(transaction) : nextNumber;
        nextNumber = number + 1;
        if (input.apply) {
          const existing = decision.existing;
          const values = {
            name: existing?.name.trim() ? existing.name : decision.member.name?.trim() || '',
            email: decision.member.primaryEmail ?? '',
            // Management API primaryEmail is an identity snapshot, not an email_verified claim.
            emailVerified: Boolean(existing?.emailVerified && existing.email.toLowerCase() === decision.member.primaryEmail?.toLowerCase()),
            picture: safeMemberPicture(decision.member.avatar),
            status: decision.status, role: decision.role, memberNumber: number,
            approvedAt: decision.member.joinedAt == null ? now : new Date(decision.member.joinedAt),
            reviewedAt: now, reviewedBy: importActor, updatedAt: now,
          };
          if (existing) await transaction.update(memberProfiles).set(values).where(eq(memberProfiles.tekidUserId, decision.member.id));
          else await transaction.insert(memberProfiles).values({ tekidUserId: decision.member.id, ...values });
        }
      }
      if (input.apply && decision.outcome !== 'already-imported') {
        // Durable even for skipped local decisions, and retained if a profile is later removed.
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
