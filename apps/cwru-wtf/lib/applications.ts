// Public membership applications.
//
// A stranger has no tekID account, so an application is a local identity with no
// subject yet: users.tekid_user_id stays null, profiles holds the answers and the
// photo, and memberships carries 'pending' with submitted_at and no member number.
// Approval is where the tekID account is created and written back, in the same
// transaction that sets 'approved'. Nothing here signs anyone in.
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { actionLogs, memberAuditLogs, memberships, profiles, users } from './schema';
import {
  applicationFieldsSchema, profileFieldNames, safeSocialLinks,
  type ProfileFields,
} from './member-profile-fields';
import {
  applicantEmailSchema, applicationHoneypotField, applicationsPerAddress,
  applicationWindowMilliseconds,
  attemptsPerAddress, recentlyApprovedWindowMilliseconds,
  type ApplicationField, type ApplicationQueue, type ApplicationView, type SignInLink,
} from './application-fields';
import { profileFieldsToRow } from './member-profiles';
import {
  reserveMemberNumber, withMemberMutationLock,
  type MembershipDatabase, type MembershipTransactionDatabase,
} from './members';
import {
  createTekidAdminClient, expiryFromTtl, tekidEmailInUse,
  TekidAdminError, type TekidAdminClient,
} from './tekid/admin';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import {
  readImageUpload, UploadError, type UploadStore,
} from './uploads';

export interface ApplicationRecord {
  userId: string;
  tekidUserId: string | null;
  email: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'suspended';
  memberNumber: number | null;
  picture: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  fields: ProfileFields;
}

export class ApplicationError extends Error {
  constructor(
    readonly status: 400 | 409 | 429 | 503,
    message: string,
    readonly errors: Partial<Record<ApplicationField, string>> = {}
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

export function toApplicationView(record: ApplicationRecord): ApplicationView {
  return {
    userId: record.userId,
    email: record.email,
    status: record.status,
    memberNumber: record.memberNumber,
    photoUrl: record.picture,
    submittedAt: record.submittedAt?.toISOString() ?? null,
    fields: record.fields,
  };
}

export interface ApplicationTransaction {
  findByEmail(email: string): Promise<ApplicationRecord | null>;
  create(input: { email: string; fields: ProfileFields; picture: string | null; submittedAt: Date }): Promise<ApplicationRecord>;
  listPending(): Promise<ApplicationRecord[]>;
  listRecentlyApproved(since: Date): Promise<ApplicationRecord[]>;
  find(userId: string): Promise<ApplicationRecord | null>;
  approve(userId: string, changes: { tekidUserId: string; memberNumber: number; at: Date; reviewedBy: string }): Promise<ApplicationRecord>;
  reject(userId: string, changes: { at: Date; reviewedBy: string }): Promise<ApplicationRecord>;
  reserveMemberNumber(): Promise<number>;
  logAction(action: string, details: string): Promise<void>;
  audit(event: { actorId: string; targetId: string; action: string; details: Record<string, unknown> }): Promise<void>;
}

export interface ApplicationStore {
  transaction<T>(operation: (transaction: ApplicationTransaction) => Promise<T>): Promise<T>;
}

export interface ApplicationSubmission {
  email: unknown;
  fields: ProfileFields;
  photo: unknown;
  honeypot: unknown;
  clientAddress: string;
}

export interface ApplicationServiceDependencies {
  store: ApplicationStore;
  uploads: UploadStore;
  tekid: () => TekidAdminClient;
  memberGroup: string;
  linkTtl: string;
  maximumUploadBytes: number;
  photoUrl: (key: string) => string;
  photoKey: (url: string) => string | null;
  limiter?: RateLimiter;
  attemptLimiter?: RateLimiter;
  now?: () => Date;
}

function tekidNames(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: (parts[0] ?? 'Member').slice(0, 50),
    lastName: (parts.slice(1).join(' ') || '-').slice(0, 50),
  };
}

// tekID usernames are a login handle, so they come from the address, stay unique
// per application, and never carry a space or a case that cannot be typed.
function tekidUsername(email: string, userId: string): string {
  const base = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${(base || 'member').slice(0, 24)}-${userId.replace(/-/g, '').slice(0, 6)}`;
}

export function createApplicationService(dependencies: ApplicationServiceDependencies) {
  // Two windows. The wide one bounds what an address can make the server read;
  // the narrow one bounds applications that are actually complete, so a person
  // correcting a highlighted field is not locked out by their own typing.
  const limiter = dependencies.limiter
    ?? createRateLimiter(applicationsPerAddress, applicationWindowMilliseconds);
  const attemptLimiter = dependencies.attemptLimiter
    ?? createRateLimiter(attemptsPerAddress, applicationWindowMilliseconds);
  const clock = dependencies.now ?? (() => new Date());

  async function submit(submission: ApplicationSubmission): Promise<ApplicationView> {
    // An unseen field that a person never fills. A filled one is answered like a
    // success so a script learns nothing from the difference.
    if (typeof submission.honeypot === 'string' && submission.honeypot.trim()) {
      throw new ApplicationError(400, 'Thanks. We have your application.');
    }
    if (!attemptLimiter.take(submission.clientAddress)) {
      throw new ApplicationError(429, 'Too many applications from this connection. Try again later.');
    }

    const email = applicantEmailSchema.safeParse(submission.email);
    const fields = applicationFieldsSchema.safeParse(submission.fields);
    const errors: Partial<Record<ApplicationField, string>> = {};
    if (!email.success) errors.email = email.error.issues[0]?.message ?? 'Enter an email address you can open.';
    if (!fields.success) {
      const fieldErrors = fields.error.flatten().fieldErrors;
      for (const name of profileFieldNames) {
        const message = fieldErrors[name]?.[0];
        if (message) errors[name] = message;
      }
    }

    let image;
    try {
      image = await readImageUpload(submission.photo, dependencies.maximumUploadBytes);
    } catch (error) {
      if (!(error instanceof UploadError)) throw error;
      errors.photo = error.message;
    }
    if (Object.keys(errors).length > 0 || !email.success || !fields.success || !image) {
      throw new ApplicationError(400, 'Check the highlighted fields.', errors);
    }
    if (!limiter.take(submission.clientAddress)) {
      throw new ApplicationError(429, 'Too many applications from this connection. Try again later.');
    }

    const key = await dependencies.uploads.save(image.bytes, image.contentType);
    try {
      return toApplicationView(await dependencies.store.transaction(async (transaction) => {
        const existing = await transaction.findByEmail(email.data);
        if (existing) {
          throw new ApplicationError(409, existing.status === 'pending'
            ? 'An application with this email is already waiting for review.'
            : 'This email already belongs to a dot*WTF account.', { email: 'This email is already in use.' });
        }
        return transaction.create({
          email: email.data,
          fields: fields.data,
          picture: dependencies.photoUrl(key),
          submittedAt: clock(),
        });
      }));
    } catch (error) {
      // An application that never committed must not leave its photo behind.
      await dependencies.uploads.delete(key).catch(() => undefined);
      throw error;
    }
  }

  // Pending applications, and the members approved from one recently enough that
  // their single-use link may still be lost. The reviewer mints another there.
  async function listQueue(): Promise<ApplicationQueue> {
    const since = new Date(clock().getTime() - recentlyApprovedWindowMilliseconds);
    return dependencies.store.transaction(async (transaction) => ({
      pending: (await transaction.listPending()).map(toApplicationView),
      recentlyApproved: (await transaction.listRecentlyApproved(since)).map(toApplicationView),
    }));
  }

  function requirePending(application: ApplicationRecord | null): ApplicationRecord {
    if (!application) throw new ApplicationError(409, 'This application no longer exists.');
    if (application.status !== 'pending') {
      throw new ApplicationError(409, 'This application has already been reviewed.');
    }
    if (application.tekidUserId) {
      throw new ApplicationError(409, 'This person already has a tekID account. Review them in the members list.');
    }
    return application;
  }

  // One transaction. The tekID account is created inside it, so a failure
  // anywhere leaves the application pending: there is never an approved member
  // without the credential the approval exists to give them. The reverse,
  // a tekID account with no approved member, is undone here before rethrowing.
  async function approve(userId: string, actorId: string): Promise<{ application: ApplicationView; link: SignInLink }> {
    const tekid = dependencies.tekid();
    let createdUserId: string | null = null;
    try {
      return await dependencies.store.transaction(async (transaction) => {
        const application = requirePending(await transaction.find(userId));
        const now = clock();

        const created = await tekid.createUser({
          ...tekidNames(application.fields.name),
          username: tekidUsername(application.email, application.userId),
          email: application.email,
        });
        createdUserId = created.id;

        const group = await tekid.findGroupByName(dependencies.memberGroup)
          ?? await tekid.createGroup(dependencies.memberGroup);
        await tekid.setUserGroups(created.id, [group.id]);

        const token = await tekid.createOneTimeAccessToken(created.id, dependencies.linkTtl);

        const memberNumber = await transaction.reserveMemberNumber();
        const approved = await transaction.approve(application.userId, {
          tekidUserId: created.id, memberNumber, at: now, reviewedBy: actorId,
        });
        await transaction.logAction('approved', `member ${memberNumber} (${application.userId})`);
        await transaction.audit({
          actorId, targetId: created.id, action: 'member.approve-application',
          details: { applicationUserId: application.userId, memberNumber, tekidAccount: 'created' },
        });
        return {
          application: toApplicationView(approved),
          link: { url: tekid.signInLink(token), expiresAt: expiryFromTtl(dependencies.linkTtl, now).toISOString() },
        };
      });
    } catch (error) {
      if (createdUserId) {
        // The local record rolled back, so this account would belong to nobody.
        await tekid.deleteUser(createdUserId).catch(() => undefined);
      }
      throw asApplicationError(error);
    }
  }

  async function reject(userId: string, actorId: string): Promise<ApplicationView> {
    return dependencies.store.transaction(async (transaction) => {
      const application = requirePending(await transaction.find(userId));
      const now = clock();
      const rejected = await transaction.reject(application.userId, { at: now, reviewedBy: actorId });
      await transaction.logAction('rejected', `application ${application.userId}`);
      await transaction.audit({
        actorId, targetId: application.userId, action: 'member.reject-application', details: {},
      });
      return toApplicationView(rejected);
    });
  }

  // The link is single use and people lose it, so the reviewer can mint another.
  async function remintSignInLink(userId: string, actorId: string): Promise<SignInLink> {
    const tekid = dependencies.tekid();
    try {
      return await dependencies.store.transaction(async (transaction) => {
        const application = await transaction.find(userId);
        if (!application) throw new ApplicationError(409, 'This member no longer exists.');
        if (application.status !== 'approved' || !application.tekidUserId) {
          throw new ApplicationError(409, 'Approve this application before sending a sign-in link.');
        }
        const now = clock();
        const token = await tekid.createOneTimeAccessToken(application.tekidUserId, dependencies.linkTtl);
        await transaction.logAction('link-reminted', `member ${application.memberNumber ?? '-'} (${application.userId})`);
        await transaction.audit({
          actorId, targetId: application.tekidUserId, action: 'member.remint-link', details: {},
        });
        return { url: tekid.signInLink(token), expiresAt: expiryFromTtl(dependencies.linkTtl, now).toISOString() };
      });
    } catch (error) {
      throw asApplicationError(error);
    }
  }

  return { submit, listQueue, approve, reject, remintSignInLink };
}

function asApplicationError(error: unknown): unknown {
  if (error instanceof TekidAdminError) {
    return new ApplicationError(
      error.code === tekidEmailInUse ? 409 : 503,
      error.code === tekidEmailInUse
        ? 'tekID already has an account with this email. Link it in the members list instead.'
        : 'tekID could not create the account, so nothing was approved. Try again.'
    );
  }
  return error;
}

function recordFromRow(row: {
  user: typeof users.$inferSelect;
  profile: typeof profiles.$inferSelect;
  membership: typeof memberships.$inferSelect;
}): ApplicationRecord {
  const links = safeSocialLinks(row.profile.socialLinks);
  return {
    userId: row.user.id,
    tekidUserId: row.user.tekidUserId,
    email: row.user.email,
    status: row.membership.status,
    memberNumber: row.membership.memberNumber,
    picture: row.profile.picture,
    submittedAt: row.membership.submittedAt,
    approvedAt: row.membership.approvedAt,
    fields: {
      name: row.profile.name, institution: row.profile.institution,
      categories: row.profile.categories, otherCategory: row.profile.otherCategory,
      whatsapp: row.profile.whatsapp, bio: row.profile.bio, wtfIdea: row.profile.wtfIdea,
      currentProject: row.profile.currentProject, youtubeLink: row.profile.youtubeLink,
      github: links.github ?? '', instagram: links.instagram ?? '',
      linkedin: links.linkedin ?? '', portfolio: links.portfolio ?? '',
    },
  };
}

export function createDatabaseApplicationStore(database: MembershipDatabase): ApplicationStore {
  return {
    transaction(operation) {
      // The same lock every other membership write takes, so a review and a
      // member-number allocation cannot interleave.
      return withMemberMutationLock(database, (transaction: MembershipTransactionDatabase) => {
        async function load(userId: string): Promise<ApplicationRecord | null> {
          const [row] = await transaction.select({ user: users, profile: profiles, membership: memberships })
            .from(users)
            .innerJoin(profiles, eq(profiles.userId, users.id))
            .innerJoin(memberships, eq(memberships.userId, users.id))
            .where(eq(users.id, userId)).limit(1);
          return row ? recordFromRow(row) : null;
        }
        return operation({
          async findByEmail(email) {
            const [row] = await transaction.select({ user: users, profile: profiles, membership: memberships })
              .from(users)
              .innerJoin(profiles, eq(profiles.userId, users.id))
              .innerJoin(memberships, eq(memberships.userId, users.id))
              .where(sql`lower(${users.email}) = ${email}`).limit(1);
            return row ? recordFromRow(row) : null;
          },
          async create({ email, fields, picture, submittedAt }) {
            const [user] = await transaction.insert(users)
              .values({ email, emailVerified: false }).returning();
            await transaction.insert(profiles)
              .values({ userId: user.id, ...profileFieldsToRow(fields), picture });
            // No member number: a pending application must never consume one.
            await transaction.insert(memberships)
              .values({ userId: user.id, status: 'pending', submittedAt });
            return (await load(user.id))!;
          },
          async listRecentlyApproved(since) {
            const rows = await transaction.select({ user: users, profile: profiles, membership: memberships })
              .from(users)
              .innerJoin(profiles, eq(profiles.userId, users.id))
              .innerJoin(memberships, eq(memberships.userId, users.id))
              .where(and(eq(memberships.status, 'approved'), gte(memberships.approvedAt, since)))
              .orderBy(desc(memberships.approvedAt))
              .limit(20);
            return rows.map(recordFromRow);
          },
          async listPending() {
            const rows = await transaction.select({ user: users, profile: profiles, membership: memberships })
              .from(users)
              .innerJoin(profiles, eq(profiles.userId, users.id))
              .innerJoin(memberships, eq(memberships.userId, users.id))
              .where(and(eq(memberships.status, 'pending'), isNull(users.tekidUserId)))
              .orderBy(asc(memberships.submittedAt), asc(users.id));
            return rows.map(recordFromRow);
          },
          find: load,
          async approve(userId, changes) {
            await transaction.update(users)
              .set({ tekidUserId: changes.tekidUserId, updatedAt: changes.at })
              .where(eq(users.id, userId));
            await transaction.update(memberships).set({
              status: 'approved', memberNumber: changes.memberNumber, approvedAt: changes.at,
              reviewedAt: changes.at, reviewedBy: changes.reviewedBy, updatedAt: changes.at,
            }).where(eq(memberships.userId, userId));
            return (await load(userId))!;
          },
          async reject(userId, changes) {
            await transaction.update(memberships).set({
              status: 'rejected', reviewedAt: changes.at,
              reviewedBy: changes.reviewedBy, updatedAt: changes.at,
            }).where(eq(memberships.userId, userId));
            return (await load(userId))!;
          },
          async reserveMemberNumber() {
            return reserveMemberNumber(transaction);
          },
          async logAction(action, details) {
            await transaction.insert(actionLogs).values({ action, details });
          },
          async audit(event) {
            await transaction.insert(memberAuditLogs).values(event);
          },
        });
      });
    },
  };
}

export { profileFieldsFromFormData as applicationFieldsFromFormData } from './member-profile-fields';
export type { ProfileFields } from './member-profile-fields';
export {
  applicantEmailSchema, applicationHoneypotField, applicationsPerAddress, attemptsPerAddress,
  applicationWindowMilliseconds, recentlyApprovedWindowMilliseconds,
} from './application-fields';
export type { ApplicationField, ApplicationQueue, ApplicationView, SignInLink } from './application-fields';
