export type MemberRole = 'member' | 'admin' | 'instance-lead';

export interface DashboardMember {
  id: string;
  name: string | null;
  email: string | null;
  picture: string | null;
  role: MemberRole;
}

export interface DashboardMembersPage {
  members: DashboardMember[];
  page: number;
  hasMore: boolean;
}
