import 'server-only';

import { eq } from 'drizzle-orm';
import { memberProfiles } from './schema';
import { safeSocialLinks } from './member-profile-fields';
import { safeMemberPicture, type DirectoryMember, type MemberStatus } from './member-types';
import type { AuthContextType } from './tekid/types';

export type MemberDirectory =
  | { status: 'signed-out' }
  | { status: 'not-member' }
  | { status: 'member'; viewerId: string; members: DirectoryMember[] };

export type DirectoryRecord = {
  id: string;
  name: string;
  picture: string | null;
  bio: string;
  socialLinks: unknown;
  memberNumber: number | null;
  status: MemberStatus;
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
    const members = approved.map((member): DirectoryMember => ({
      id: member.id, name: member.name.trim() || null,
      picture: safeMemberPicture(member.picture), bio: member.bio,
      links: safeSocialLinks(member.socialLinks), memberNumber: member.memberNumber,
    }));
    members.sort((a, b) => (a.memberNumber ?? Infinity) - (b.memberNumber ?? Infinity) ||
      (a.name ?? '').localeCompare(b.name ?? '', 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
    return { status: 'member', viewerId: auth.claims.sub, members };
  };
}

export async function getMemberDirectory(): Promise<MemberDirectory> {
  const { getTekidAuthContext } = await import('./tekid/server');
  return createMemberDirectory({
    getAuthContext: getTekidAuthContext,
    async loadMembers() {
      const { db } = await import('./db');
      return db.select({
        id: memberProfiles.tekidUserId, name: memberProfiles.name,
        picture: memberProfiles.picture, bio: memberProfiles.bio,
        socialLinks: memberProfiles.socialLinks, memberNumber: memberProfiles.memberNumber,
        status: memberProfiles.status,
      }).from(memberProfiles).where(eq(memberProfiles.status, 'approved'));
    },
  })();
}
