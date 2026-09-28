import 'server-only';

import { eq, sql } from 'drizzle-orm';
import { memberships, profiles, users } from './schema';
import type { MemberRecordDatabase } from './member-records';
import { safeSocialLinks } from './member-profile-fields';
import { safeMemberPicture, type DirectoryMember, type MemberStatus } from './member-types';
import type { AuthContextType } from './tekid/types';

export type MemberDirectory =
  | { status: 'signed-out' }
  | { status: 'not-member' }
  | { status: 'member'; viewerId: string; members: DirectoryMember[] };

export type DirectoryRecord = {
  id: string;
  name: string | null;
  picture: string | null;
  bio: string | null;
  socialLinks: unknown;
  memberNumber: number | null;
  status: MemberStatus;
  hasProfile?: boolean;
};

export function createMemberDirectory(dependencies: {
  getAuthContext: () => Promise<AuthContextType>;
  loadMembers: () => Promise<DirectoryRecord[]>;
}) {
  return async function getMemberDirectory(): Promise<MemberDirectory> {
    const auth = await dependencies.getAuthContext();
    if (!auth.isAuthenticated) return { status: 'signed-out' };
    // A single local query supplies both the viewer's approval and the directory snapshot.
    // No token claims or stale Management API role/membership state grant access.
    const approved = (await dependencies.loadMembers()).filter((member) => member.status === 'approved');
    if (!approved.some((member) => member.id === auth.claims.sub)) return { status: 'not-member' };
    const members = approved.filter((member) => member.hasProfile !== false).map((member): DirectoryMember => ({
      id: member.id, name: member.name?.trim() || null,
      picture: safeMemberPicture(member.picture), bio: member.bio ?? '',
      links: safeSocialLinks(member.socialLinks), memberNumber: member.memberNumber,
    }));
    members.sort((a, b) => (a.memberNumber ?? Infinity) - (b.memberNumber ?? Infinity) ||
      (a.name ?? '').localeCompare(b.name ?? '', 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
    return { status: 'member', viewerId: auth.claims.sub, members };
  };
}

export function loadDirectoryRecords(database: MemberRecordDatabase): PromiseLike<DirectoryRecord[]> {
  // Membership authorizes the viewer even before a profile exists. Only actual
  // profiles become directory entries, using the same database snapshot.
  return database.select({
    id: users.tekidUserId, name: profiles.name,
    picture: profiles.picture, bio: profiles.bio,
    socialLinks: profiles.socialLinks, memberNumber: memberships.memberNumber,
    status: memberships.status, hasProfile: sql<boolean>`${profiles.userId} is not null`,
  }).from(users).innerJoin(memberships, eq(memberships.userId, users.id))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(memberships.status, 'approved'));
}

export async function getMemberDirectory(): Promise<MemberDirectory> {
  const { getTekidAuthContext } = await import('./tekid/server');
  return createMemberDirectory({
    getAuthContext: getTekidAuthContext,
    async loadMembers() {
      const { db } = await import('./db');
      return loadDirectoryRecords(db);
    },
  })();
}
