import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { memberAuditLogs, memberProfiles, submissions } from './schema';
import type { AuthSession } from './tekid/types';
import {
  applicationFieldsSchema, categoryOptions, emptyProfileFields, profileFieldsSchema,
  profileLimits, safeSocialLinks, socialPlatforms,
  type ProfileFields, type SocialLinks,
} from './member-profile-fields';

export type ProfileDatabase = PostgresJsDatabase<typeof schema>;
type ProfileTransaction = Parameters<Parameters<ProfileDatabase['transaction']>[0]>[0];
type ProfileRow = typeof memberProfiles.$inferSelect;
type LegacyApplication = Pick<typeof submissions.$inferSelect,
  'name' | 'categories' | 'otherCategory' | 'whatsapp' | 'wtfIdea' | 'currentProject' | 'youtubeLink'>;

export interface MemberProfileView {
  fields: ProfileFields;
  imported: boolean;
  status: ProfileRow['status'];
  memberNumber: number | null;
  submittedAt: string | null;
}

export class ProfileSubmissionError extends Error {}

function safePicture(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function importedProfileFields(application: LegacyApplication): ProfileFields {
  const video = profileFieldsSchema.shape.youtubeLink.safeParse(application.youtubeLink);
  let categories: string[] = [];
  try {
    const value: unknown = JSON.parse(application.categories);
    if (Array.isArray(value)) categories = value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim());
  } catch { /* Legacy free text is kept below as an Other category. */ }
  const recognized = categories.filter((entry) => (categoryOptions as readonly string[]).includes(entry));
  const unknown = categories.filter((entry) => !(categoryOptions as readonly string[]).includes(entry));
  if (unknown.length && !recognized.includes('Other')) recognized.push('Other');
  return {
    ...emptyProfileFields,
    name: application.name.trim().slice(0, 128),
    categories: [...new Set(recognized)],
    otherCategory: (application.otherCategory || unknown.join(', ')).trim().slice(0, 200),
    whatsapp: (application.whatsapp ?? '').trim().slice(0, 40),
    wtfIdea: application.wtfIdea.trim().slice(0, profileLimits.text),
    currentProject: application.currentProject.trim().slice(0, profileLimits.text),
    youtubeLink: video.success ? video.data : '',
  };
}

export function profileFieldsFromRow(row: ProfileRow): ProfileFields {
  const links = safeSocialLinks(row.socialLinks);
  return {
    name: row.name, institution: row.institution, categories: row.categories,
    otherCategory: row.otherCategory, whatsapp: row.whatsapp,
    bio: row.bio, wtfIdea: row.wtfIdea, currentProject: row.currentProject,
    youtubeLink: row.youtubeLink, github: links.github ?? '',
    instagram: links.instagram ?? '', linkedin: links.linkedin ?? '', portfolio: links.portfolio ?? '',
  };
}

export function profileFieldsToRow({ github, instagram, linkedin, portfolio, ...fields }: ProfileFields) {
  const links = { github, instagram, linkedin, portfolio };
  const socialLinks: SocialLinks = Object.fromEntries(socialPlatforms.flatMap((platform) => links[platform] ? [[platform, links[platform]]] : []));
  return { ...fields, socialLinks };
}

function profileView(row: ProfileRow, imported = false): MemberProfileView {
  return {
    fields: profileFieldsFromRow(row), imported, status: row.status,
    memberNumber: row.memberNumber, submittedAt: row.submittedAt?.toISOString() ?? null,
  };
}

// Injecting the database lets integration tests exercise the actual transactions.
export function createProfileStore(database: ProfileDatabase) {
  async function initializeProfile(tx: ProfileTransaction, claims: AuthSession) {
    const [saved] = await tx.select().from(memberProfiles).where(eq(memberProfiles.tekidUserId, claims.sub)).for('update');
    const identity = { email: claims.email, emailVerified: claims.email_verified, picture: safePicture(claims.picture) };
    // Pre-migration rows have no email. Hydrate newly added application fields once,
    // without overwriting existing profile answers or any local access decision.
    const firstVerifiedVisit = Boolean(saved?.email && !saved.emailVerified && claims.email_verified);
    const [previousImport] = firstVerifiedVisit ? await tx.select({ id: memberAuditLogs.id })
      .from(memberAuditLogs).where(and(eq(memberAuditLogs.targetId, claims.sub),
        eq(memberAuditLogs.action, 'profile.legacy-imported'))).limit(1) : [];
    if (saved?.email && (!firstVerifiedVisit || previousImport)) {
      const [row] = await tx.update(memberProfiles).set(identity)
        .where(eq(memberProfiles.tekidUserId, claims.sub)).returning();
      return { row, imported: false };
    }
    const [application] = claims.email_verified
      ? await tx.select().from(submissions)
        .where(sql`lower(${submissions.email}) = ${claims.email.trim().toLowerCase()}`)
        .orderBy(desc(submissions.createdAt), desc(submissions.id)).limit(1)
      : [];
    const importedFields = application ? importedProfileFields(application) : { ...emptyProfileFields, name: claims.name };
    const fields: ProfileFields = saved ? {
      ...importedFields, ...profileFieldsFromRow(saved), name: saved.name || importedFields.name || claims.name,
      categories: saved.categories.length ? saved.categories : importedFields.categories,
      otherCategory: saved.otherCategory || importedFields.otherCategory,
      whatsapp: saved.whatsapp || importedFields.whatsapp,
    } : { ...importedFields, name: importedFields.name || claims.name };
    // A first unverified sign-in cannot import by email. When verification arrives,
    // fill only still-empty answers; keep every answer already saved by the user.
    if (saved && firstVerifiedVisit && application) {
      const existing = profileFieldsFromRow(saved);
      for (const field of ['name', 'otherCategory', 'whatsapp', 'wtfIdea', 'currentProject', 'youtubeLink'] as const) {
        fields[field] = existing[field] || importedFields[field];
      }
    }
    const values = { ...profileFieldsToRow(fields), ...identity };
    const [row] = saved
      ? await tx.update(memberProfiles).set(values).where(eq(memberProfiles.tekidUserId, claims.sub)).returning()
      : await tx.insert(memberProfiles).values({ tekidUserId: claims.sub, ...values }).returning();
    if (claims.email_verified) await tx.insert(memberAuditLogs).values({
      actorId: claims.sub, targetId: claims.sub, action: 'profile.legacy-imported',
      details: { applicationFound: Boolean(application) },
    });
    return { row, imported: Boolean(application) };
  }

  async function getProfile(claims: AuthSession): Promise<MemberProfileView> {
    return database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('dot-wtf:membership', 0))`);
      const { row, imported } = await initializeProfile(tx, claims);
      return profileView(row, imported);
    });
  }

  async function saveProfile(claims: AuthSession, input: ProfileFields, intent: 'save' | 'submit' = 'save'): Promise<MemberProfileView> {
    const fields = (intent === 'submit' ? applicationFieldsSchema : profileFieldsSchema).parse(input);
    if (intent === 'submit' && !claims.email_verified) {
      throw new ProfileSubmissionError('Verify your email in tekID, then sign in again before submitting your application.');
    }
    return database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('dot-wtf:membership', 0))`);
      const { row: current } = await initializeProfile(tx, claims);
      if (intent === 'submit' && current.status === 'suspended') {
        throw new ProfileSubmissionError('Your membership is suspended. Contact an admin before applying again.');
      }
      const isNewSubmission = intent === 'submit' && (current.status === 'draft' || current.status === 'rejected');
      const [row] = await tx.update(memberProfiles).set({
        ...profileFieldsToRow(fields), updatedAt: new Date(),
        ...(isNewSubmission ? { status: 'pending' as const, submittedAt: new Date() } : {}),
      }).where(eq(memberProfiles.tekidUserId, claims.sub)).returning();
      if (isNewSubmission) await tx.insert(memberAuditLogs).values({
        actorId: claims.sub, targetId: claims.sub, action: 'profile.submitted', details: { previousStatus: current.status },
      });
      return profileView(row);
    });
  }
  return { getProfile, saveProfile };
}

export async function getMemberProfile(claims: AuthSession) {
  const { db } = await import('./db');
  return createProfileStore(db).getProfile(claims);
}

export async function saveMemberProfile(claims: AuthSession, fields: ProfileFields, intent: 'save' | 'submit' = 'save') {
  const { db } = await import('./db');
  return createProfileStore(db).saveProfile(claims, fields, intent);
}
