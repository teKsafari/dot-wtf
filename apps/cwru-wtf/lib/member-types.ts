import type { ProfileFields, SocialLinks } from './member-profile-fields';

export const memberStatuses = ['draft', 'pending', 'approved', 'rejected', 'suspended'] as const;
export type MemberStatus = typeof memberStatuses[number];
export type MemberStatusFilter = MemberStatus | 'all';
export type MemberRole = 'member' | 'admin' | 'instance-lead';

export type MemberApplicationFields = Omit<ProfileFields, 'categories'> & {
  name: string;
  categories: string[];
  otherCategory: string;
  institution: string;
  whatsapp: string;
};

export interface DashboardMember {
  id: string;
  name: string | null;
  email: string | null;
  picture: string | null;
  role: MemberRole;
  status: MemberStatus;
  memberNumber: number | null;
  submittedAt: string | null;
  approvedAt: string | null;
  fields: MemberApplicationFields;
}

export interface DashboardMembersPage {
  members: DashboardMember[];
  page: number;
  hasMore: boolean;
  status: MemberStatusFilter;
}

// Only these fields may cross the directory's server/client boundary.
export interface DirectoryMember {
  id: string;
  name: string | null;
  picture: string | null;
  bio: string;
  links: SocialLinks;
  memberNumber: number | null;
}

export function safeMemberPicture(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
