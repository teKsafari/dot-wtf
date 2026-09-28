import 'server-only';

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { memberProfiles, submissions } from '@/lib/schema';
import type { AuthSession } from '@/lib/tekid/types';
import type { DirectoryMember } from '@/lib/tekid/member-types';
import {
  emptyProfileFields,
  profileFieldsSchema,
  profileLimits,
  safeSocialLinks,
  type ProfileFields,
  type SocialLinks,
  type SocialPlatform,
} from './member-profile-fields';

type ApplicationFields = Pick<ProfileFields, 'wtfIdea' | 'currentProject' | 'youtubeLink'>;

export interface MemberProfileView {
  fields: ProfileFields;
  // True only on the request that copied the member's application into their profile.
  imported: boolean;
}

// Application answers become ordinary profile fields, so they must pass the same checks.
export function importedProfileFields(application: ApplicationFields): ProfileFields {
  const link = profileFieldsSchema.shape.youtubeLink.safeParse(application.youtubeLink);
  return {
    ...emptyProfileFields,
    wtfIdea: application.wtfIdea.trim().slice(0, profileLimits.text),
    currentProject: application.currentProject.trim().slice(0, profileLimits.text),
    youtubeLink: link.success ? link.data : '',
  };
}

export function createMemberProfiles(dependencies: {
  findProfile: (userId: string) => Promise<ProfileFields | null>;
  findApplication: (email: string) => Promise<ApplicationFields | null>;
  // Resolves false when another request created the profile first.
  insertProfile: (userId: string, fields: ProfileFields) => Promise<boolean>;
}) {
  async function getProfile(claims: AuthSession): Promise<MemberProfileView> {
    const saved = await dependencies.findProfile(claims.sub);
    if (saved) return { fields: saved, imported: false };

    // Only an address tekID has verified can claim an application.
    const application = claims.email_verified
      ? await dependencies.findApplication(claims.email)
      : null;
    if (!application) return { fields: emptyProfileFields, imported: false };

    const fields = importedProfileFields(application);
    if (await dependencies.insertProfile(claims.sub, fields)) return { fields, imported: true };
    return { fields: (await dependencies.findProfile(claims.sub)) ?? fields, imported: false };
  }

  return { getProfile };
}

const profileColumns = {
  bio: memberProfiles.bio,
  wtfIdea: memberProfiles.wtfIdea,
  currentProject: memberProfiles.currentProject,
  youtubeLink: memberProfiles.youtubeLink,
  socialLinks: memberProfiles.socialLinks,
};

// The form edits each link as its own field; the table keeps them in one column.
type ProfileRow = Omit<ProfileFields, SocialPlatform> & { socialLinks: SocialLinks };

function toProfileFields({ socialLinks, ...fields }: ProfileRow): ProfileFields {
  const links = safeSocialLinks(socialLinks);
  return {
    ...fields,
    github: links.github ?? '',
    instagram: links.instagram ?? '',
    linkedin: links.linkedin ?? '',
    portfolio: links.portfolio ?? '',
  };
}

function toProfileRow({ github, instagram, linkedin, portfolio, ...fields }: ProfileFields): ProfileRow {
  return { ...fields, socialLinks: safeSocialLinks({ github, instagram, linkedin, portfolio }) };
}

const memberProfileStore = createMemberProfiles({
  async findProfile(userId) {
    const { db } = await import('@/lib/db');
    const [profile] = await db
      .select(profileColumns)
      .from(memberProfiles)
      .where(eq(memberProfiles.tekidUserId, userId))
      .limit(1);
    return profile ? toProfileFields(profile) : null;
  },
  async findApplication(email) {
    const { db } = await import('@/lib/db');
    const [application] = await db
      .select({
        wtfIdea: submissions.wtfIdea,
        currentProject: submissions.currentProject,
        youtubeLink: submissions.youtubeLink,
      })
      .from(submissions)
      .where(sql`lower(${submissions.email}) = ${email.trim().toLowerCase()}`)
      .orderBy(desc(submissions.createdAt))
      .limit(1);
    return application ?? null;
  },
  async insertProfile(userId, fields) {
    const { db } = await import('@/lib/db');
    const created = await db
      .insert(memberProfiles)
      .values({ tekidUserId: userId, ...toProfileRow(fields) })
      .onConflictDoNothing({ target: memberProfiles.tekidUserId })
      .returning({ tekidUserId: memberProfiles.tekidUserId });
    return created.length > 0;
  },
});

export const getMemberProfile = (claims: AuthSession) => memberProfileStore.getProfile(claims);

export async function saveMemberProfile(userId: string, fields: ProfileFields): Promise<void> {
  const { db } = await import('@/lib/db');
  const row = toProfileRow(fields);
  await db
    .insert(memberProfiles)
    .values({ tekidUserId: userId, ...row })
    .onConflictDoUpdate({
      target: memberProfiles.tekidUserId,
      set: { ...row, updatedAt: new Date() },
    });
}

export async function hasApprovedApplication(email: string): Promise<boolean> {
  const { db } = await import('@/lib/db');
  const [application] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(and(
      sql`lower(${submissions.email}) = ${email.trim().toLowerCase()}`,
      eq(submissions.isApproved, true),
      isNull(submissions.archivedAt)
    ))
    .limit(1);
  return Boolean(application);
}

export type MemberCard = Pick<DirectoryMember, 'bio' | 'links'>;

export async function getMemberCards(userIds: string[]): Promise<Map<string, MemberCard>> {
  if (userIds.length === 0) return new Map();
  const { db } = await import('@/lib/db');
  const rows = await db
    .select({ id: memberProfiles.tekidUserId, bio: memberProfiles.bio, socialLinks: memberProfiles.socialLinks })
    .from(memberProfiles)
    .where(inArray(memberProfiles.tekidUserId, userIds));
  return new Map(rows.map(({ id, bio, socialLinks }) => [id, { bio, links: safeSocialLinks(socialLinks) }]));
}
