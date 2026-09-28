import 'server-only';

import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './schema';
import { memberships, profiles, users } from './schema';

// Database relations use local UUIDs. The external tekID ID stays at API boundaries.
export const memberRecordSelection = {
  userId: users.id,
  membershipId: memberships.id,
  tekidUserId: users.tekidUserId,
  email: users.email,
  emailVerified: users.emailVerified,
  name: profiles.name,
  picture: profiles.picture,
  categories: profiles.categories,
  institution: profiles.institution,
  otherCategory: profiles.otherCategory,
  whatsapp: profiles.whatsapp,
  bio: profiles.bio,
  wtfIdea: profiles.wtfIdea,
  currentProject: profiles.currentProject,
  youtubeLink: profiles.youtubeLink,
  socialLinks: profiles.socialLinks,
  status: memberships.status,
  role: memberships.role,
  memberNumber: memberships.memberNumber,
  submittedAt: memberships.submittedAt,
  approvedAt: memberships.approvedAt,
  reviewedAt: memberships.reviewedAt,
  reviewedBy: memberships.reviewedBy,
  createdAt: memberships.createdAt,
  updatedAt: memberships.updatedAt,
};

export type MemberRecord =
  Pick<typeof users.$inferSelect, 'tekidUserId' | 'email' | 'emailVerified'> &
  Omit<typeof profiles.$inferSelect, 'userId' | 'createdAt' | 'updatedAt'> &
  Omit<typeof memberships.$inferSelect, 'id'> & { membershipId: string };

export type MemberRecordDatabase = Pick<PostgresJsDatabase<typeof schema>, 'select'>;

export function selectMemberRecords(database: MemberRecordDatabase) {
  return database.select(memberRecordSelection).from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .innerJoin(memberships, eq(memberships.userId, users.id)).$dynamic();
}

export async function findMemberRecordByTekidId(database: MemberRecordDatabase, tekidUserId: string): Promise<MemberRecord | null> {
  const [member] = await selectMemberRecords(database).where(eq(users.tekidUserId, tekidUserId)).limit(1);
  return member ?? null;
}

// Administrative access must remain revocable if an identity has a membership
// before its profile exists. These empty answers are a management projection;
// profile initialization and operator imports must use the inner-join helper.
export function selectManagementMemberRecords(database: MemberRecordDatabase) {
  return database.select({
    ...memberRecordSelection,
    name: sql<string>`coalesce(${profiles.name}, '')`,
    categories: sql<MemberRecord['categories']>`coalesce(${profiles.categories}, '[]'::jsonb)`,
    institution: sql<string>`coalesce(${profiles.institution}, '')`,
    otherCategory: sql<string>`coalesce(${profiles.otherCategory}, '')`,
    whatsapp: sql<string>`coalesce(${profiles.whatsapp}, '')`,
    bio: sql<string>`coalesce(${profiles.bio}, '')`,
    wtfIdea: sql<string>`coalesce(${profiles.wtfIdea}, '')`,
    currentProject: sql<string>`coalesce(${profiles.currentProject}, '')`,
    youtubeLink: sql<string>`coalesce(${profiles.youtubeLink}, '')`,
    socialLinks: sql<MemberRecord['socialLinks']>`coalesce(${profiles.socialLinks}, '{}'::jsonb)`,
  }).from(users).innerJoin(memberships, eq(memberships.userId, users.id))
    .leftJoin(profiles, eq(profiles.userId, users.id)).$dynamic();
}

export async function findManagementMemberRecordByTekidId(database: MemberRecordDatabase, tekidUserId: string): Promise<MemberRecord | null> {
  const [member] = await selectManagementMemberRecords(database).where(eq(users.tekidUserId, tekidUserId)).limit(1);
  return member ?? null;
}

export async function findMemberAccessByTekidId(database: MemberRecordDatabase, tekidUserId: string) {
  const [member] = await database.select({ status: memberships.status, role: memberships.role })
    .from(users).innerJoin(memberships, eq(memberships.userId, users.id))
    .where(eq(users.tekidUserId, tekidUserId)).limit(1);
  return member ?? null;
}
