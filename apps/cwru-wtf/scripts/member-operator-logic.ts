import { z } from 'zod';
import type { MemberRole, MemberStatus } from '../lib/member-types';

export class OperatorError extends Error {}
export const importAuditAction = 'member.import-logto';
export const bootstrapActor = 'operator:bootstrap';
export const importActor = 'operator:logto-import';
export const operatorUserIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
const legacyMemberSchema = z.object({
  id: operatorUserIdSchema,
  name: z.string().nullable(),
  primaryEmail: z.string().email().nullable(),
  avatar: z.string().nullable(),
  isSuspended: z.boolean(),
  createdAt: timestamp,
  // Current Logto OSS responses omit membership time. Accept it when supplied.
  joinedAt: timestamp.nullish(),
  organizationRoles: z.array(z.object({ id: operatorUserIdSchema })),
});
export type LegacyMember = z.infer<typeof legacyMemberSchema>;
export interface OperatorProfile {
  tekidUserId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: MemberRole;
  status: MemberStatus;
  memberNumber: number | null;
  approvedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
}
export interface ImportDecision {
  member: LegacyMember;
  existing?: OperatorProfile;
  outcome: 'import' | 'already-imported' | 'local-decision';
  role: MemberRole;
  status: 'approved' | 'suspended';
  orderingTime: number;
  orderingSource: 'joinedAt' | 'createdAt';
}

export function planBootstrap(profiles: OperatorProfile[], role: 'admin' | 'instance-lead') {
  if (profiles.length !== 1) throw new OperatorError(profiles.length
    ? 'More than one local profile matched. Use --user-id to choose the intended verified account.'
    : 'No local profile matched. The person must sign in and open /profile first.');
  const profile = profiles[0]!;
  if (!profile.emailVerified || !profile.email.trim()) throw new OperatorError('The local profile must have a verified email. Sign in again after verifying it.');
  if (profile.status === 'suspended' || profile.status === 'rejected') throw new OperatorError('This profile has a revoked or rejected local decision. Restore it through an administrator review first.');
  if (profile.role === 'admin' && role !== 'admin') throw new OperatorError('This command cannot demote an administrator. Use another administrator in the dashboard.');
  return { profile, unchanged: profile.status === 'approved' && profile.role === role && profile.memberNumber !== null };
}

export function planLegacyImport(input: {
  members: LegacyMember[];
  profiles: OperatorProfile[];
  priorDecisions: { targetId: string; action: string }[];
  adminRoleId: string;
  instanceLeadRoleId: string;
}): ImportDecision[] {
  if (input.adminRoleId === input.instanceLeadRoleId) throw new OperatorError('Import role IDs must be distinct.');
  const profiles = new Map(input.profiles.map((profile) => [profile.tekidUserId, profile]));
  const imported = new Set(input.priorDecisions.filter(({ action }) => action === importAuditAction).map(({ targetId }) => targetId));
  const locallyReviewed = new Set(input.priorDecisions.filter(({ action }) => action.startsWith('member.')).map(({ targetId }) => targetId));
  const seen = new Set<string>();
  return input.members.map((member): ImportDecision => {
    if (seen.has(member.id)) throw new OperatorError('The Logto snapshot contains duplicate members. Retry while membership changes are paused.');
    seen.add(member.id);
    const existing = profiles.get(member.id);
    const roleIds = new Set(member.organizationRoles.map(({ id }) => id));
    const hasLocalDecision = locallyReviewed.has(member.id) || Boolean(existing && (
      existing.status !== 'draft' || existing.role !== 'member' || existing.memberNumber !== null ||
      existing.approvedAt || existing.reviewedAt || existing.reviewedBy
    ));
    return {
      member, existing,
      outcome: imported.has(member.id) ? 'already-imported' : hasLocalDecision ? 'local-decision' : 'import',
      role: roleIds.has(input.adminRoleId) ? 'admin' : roleIds.has(input.instanceLeadRoleId) ? 'instance-lead' : 'member',
      status: member.isSuspended ? 'suspended' : 'approved',
      orderingTime: member.joinedAt ?? member.createdAt,
      orderingSource: member.joinedAt == null ? 'createdAt' : 'joinedAt',
    };
  }).sort((a, b) => a.orderingTime - b.orderingTime || (a.member.id < b.member.id ? -1 : a.member.id > b.member.id ? 1 : 0));
}

export interface LegacyReader {
  get(path: string, query?: Record<string, string>): Promise<{ data: unknown; total: string | null }>;
}

export async function readLegacyMembers(reader: LegacyReader, organizationId: string): Promise<LegacyMember[]> {
  const members: LegacyMember[] = [];
  const ids = new Set<string>();
  let expectedTotal: number | undefined;
  for (let page = 1; page <= 10_000; page++) {
    const result = await reader.get(`/api/organizations/${encodeURIComponent(organizationId)}/users`, { page: String(page), page_size: '100' });
    const parsed = z.array(legacyMemberSchema).safeParse(result.data);
    if (!parsed.success) throw new OperatorError('Logto returned an invalid member snapshot. No database changes were made.');
    if (result.total !== null) {
      if (!/^\d+$/.test(result.total) || !Number.isSafeInteger(Number(result.total))) throw new OperatorError('Logto returned an invalid pagination total.');
      const total = Number(result.total);
      if (expectedTotal !== undefined && expectedTotal !== total) throw new OperatorError('Logto membership changed during pagination. Pause membership changes and retry.');
      expectedTotal = total;
    }
    for (const member of parsed.data) {
      if (ids.has(member.id)) throw new OperatorError('Logto pagination repeated a member. Pause membership changes and retry.');
      ids.add(member.id);
      members.push(member);
    }
    if (expectedTotal !== undefined) {
      if (members.length > expectedTotal || (parsed.data.length === 0 && members.length < expectedTotal)) throw new OperatorError('Logto pagination did not match its reported total.');
      if (members.length === expectedTotal) return members;
    } else if (parsed.data.length < 100) return members;
  }
  throw new OperatorError('Logto pagination exceeded its safety limit. No database changes were made.');
}
