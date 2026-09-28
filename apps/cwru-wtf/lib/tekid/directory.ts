import 'server-only';

import { z } from 'zod';
import {
  getTekidManagementClient,
  getTekidOrganizationConfig,
  type TekidManagementClient,
  type TekidOrganizationConfig,
} from './management';
import type { DirectoryMember } from './member-types';
import { safePicture, userSchema } from './members';
import { listAllManagementItems } from './pagination';
import type { AuthContextType } from './types';

export type MemberDirectory =
  | { status: 'signed-out' }
  | { status: 'not-member' }
  | { status: 'member'; viewerId: string; members: DirectoryMember[] };

export function createMemberDirectory(dependencies: {
  getAuthContext: () => Promise<AuthContextType>;
  management: TekidManagementClient;
  organization: TekidOrganizationConfig;
  loadCards: (userIds: string[]) => Promise<Map<string, Pick<DirectoryMember, 'bio' | 'links'>>>;
}) {
  return async function getMemberDirectory(): Promise<MemberDirectory> {
    const auth = await dependencies.getAuthContext();
    if (!auth.isAuthenticated) return { status: 'signed-out' };

    const users = await listAllManagementItems(
      dependencies.management,
      `/api/organizations/${encodeURIComponent(dependencies.organization.organizationId)}/users`,
      (data) => z.array(userSchema).parse(data)
    );
    // Suspended accounts neither appear in the directory nor can open it.
    const active = users.filter((user) => !user.isSuspended);
    if (!active.some((user) => user.id === auth.claims.sub)) return { status: 'not-member' };

    const cards = await dependencies.loadCards(active.map(({ id }) => id));
    const members = active.map((user) => ({
      id: user.id,
      name: user.name?.trim() || null,
      picture: safePicture(user.avatar),
      bio: cards.get(user.id)?.bio ?? '',
      links: cards.get(user.id)?.links ?? {},
    }));
    members.sort((a, b) =>
      a.name === null || b.name === null
        ? Number(a.name === null) - Number(b.name === null)
        : a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
    );
    return { status: 'member', viewerId: auth.claims.sub, members };
  };
}

export async function getMemberDirectory(): Promise<MemberDirectory> {
  const [{ getTekidAuthContext }, { getMemberCards }] = await Promise.all([
    import('./server'),
    import('@/lib/member-profiles'),
  ]);
  return createMemberDirectory({
    getAuthContext: getTekidAuthContext,
    management: getTekidManagementClient(),
    organization: getTekidOrganizationConfig(),
    loadCards: getMemberCards,
  })();
}
