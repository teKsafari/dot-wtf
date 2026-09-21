import './test-env';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDashboardAuthorization,
  dashboardPermissions,
  TekidAuthorizationError,
} from '../lib/tekid/authorization';
import { createMemberService, TekidMemberError } from '../lib/tekid/members';
import { createTekidManagementClient, TekidManagementError, type TekidManagementClient } from '../lib/tekid/management';
import { assertSameOriginMutation } from '../lib/tekid/request';
import { listAllManagementItems } from '../lib/tekid/pagination';
import type { AuthContextType } from '../lib/tekid/types';

const organization = { organizationId: 'cwru', adminRoleId: 'admin-role', instanceLeadRoleId: 'lead-role' };
const claims = (sub: string) => ({
  sub, name: sub, email: `${sub}@example.org`, email_verified: true,
  username: null, picture: null,
});
const isStatus = (status: number) => (error: unknown) =>
  (error instanceof TekidAuthorizationError || error instanceof TekidMemberError) && error.status === status;

function fixture(actorId = 'admin') {
  const roles = new Map<string, string[]>([
    ['cwru:admin', ['admin-role']],
    ['cwru:lead', ['lead-role']],
    ['cwru:member', []],
    ['another-instance:outsider', ['admin-role']],
  ]);
  const users = ['admin', 'lead', 'member', 'outsider', 'newcomer'].map((id) => ({
    id, name: `Display ${id}`, primaryEmail: `${id}@example.org`, avatar: null as string | null,
    isSuspended: false,
    customData: { private: 'Do not send to the browser' },
    passwordDigest: 'Never serialize this',
  }));
  const calls: { method: string; path: string; body?: unknown; query?: Record<string, string> }[] = [];
  const audits: unknown[] = [];
  let signedIn = true;
  let failRequests = false;
  let failRoleAssignment = false;
  let extraLeadScope = false;
  let rolePaginationFault: { userId: string; kind: 'malformed-total' | 'changed-total' | 'repeated-page' | 'truncated-page' } | undefined;
  let lockTail = Promise.resolve();

  const management: TekidManagementClient = {
    async request(method, path, options = {}) {
      calls.push({ method, path, ...options });
      if (failRequests) throw new TekidManagementError(503);
      const reply = (data: unknown, total?: number) => ({
        data,
        headers: new Headers(total === undefined ? {} : { 'total-number': String(total) }),
      });
      const match = path.match(/^\/api\/organizations\/([^/]+)\/users(?:\/([^/]+)\/(roles|scopes))?$/);
      if (match) {
        const [, org, userId, kind] = match;
        const key = `${org}:${userId}`;
        if (kind && method === 'GET') {
          const ids = roles.get(key);
          if (!ids) throw new TekidManagementError(422);
          if (kind === 'roles') {
            const page = Number(options.query?.page ?? 1);
            const pageSize = Number(options.query?.page_size ?? 20);
            const fault = rolePaginationFault?.userId === userId ? rolePaginationFault.kind : undefined;
            const start = fault === 'repeated-page' ? 0 : (page - 1) * pageSize;
            const data = fault === 'truncated-page' && page > 1 ? [] : ids.slice(start, start + pageSize).map((id) => ({ id }));
            const response = reply(data, ids.length);
            if (fault === 'malformed-total') response.headers.set('total-number', 'unknown');
            if (fault === 'changed-total' && page > 1) response.headers.set('total-number', String(ids.length + 1));
            return response;
          }
          const names = ids.includes('admin-role') ? [...dashboardPermissions]
            : ids.includes('lead-role') ? dashboardPermissions.filter((name) => extraLeadScope || name !== 'members:assign-roles')
              : [];
          return reply(names.map((name) => ({ name })));
        }
        if (kind === 'roles' && (method === 'POST' || method === 'PUT')) {
          if (failRoleAssignment) throw new TekidManagementError(503);
          if (!roles.has(key)) throw new TekidManagementError(422);
          const ids = (options.body as { organizationRoleIds: string[] }).organizationRoleIds;
          roles.set(key, method === 'PUT' ? ids : [...new Set([...(roles.get(key) ?? []), ...ids])]);
          return reply(undefined);
        }
        if (!kind && method === 'GET') {
          const members = users.filter((user) => roles.has(`${org}:${user.id}`))
            .filter((user) => !options.query?.organizationRoleId || roles.get(`${org}:${user.id}`)?.includes(options.query.organizationRoleId))
            .map((user) => ({ ...user, organizationRoles: roles.get(`${org}:${user.id}`)!.map((id) => ({ id })) }));
          const page = Number(options.query?.page ?? 1);
          const pageSize = Number(options.query?.page_size ?? 20);
          return reply(members.slice((page - 1) * pageSize, page * pageSize), members.length);
        }
        if (!kind && method === 'POST') {
          for (const id of (options.body as { userIds: string[] }).userIds) {
            if (!roles.has(`${org}:${id}`)) roles.set(`${org}:${id}`, []);
          }
          return reply(undefined);
        }
      }
      if (method === 'GET' && path === '/api/users') {
        assert.equal(options.query?.['mode.primaryEmail'], 'exact');
        assert.equal(options.query?.page_size, '2');
        const email = options.query?.['search.primaryEmail'].toLowerCase();
        return reply(users.filter((user) => user.primaryEmail.toLowerCase() === email));
      }
      if (method === 'GET' && path.startsWith('/api/users/')) {
        const user = users.find((item) => item.id === path.slice('/api/users/'.length));
        if (!user) throw new TekidManagementError(404);
        return reply(user);
      }
      assert.fail(`Unexpected test request: ${method} ${path}`);
    },
  };

  function authorizationFor(id: string) {
    return createDashboardAuthorization({
      organization,
      management,
      getAuthContext: async (): Promise<AuthContextType> => signedIn
        ? { isAuthenticated: true, claims: claims(id) }
        : { isAuthenticated: false, claims: null },
    });
  }

  const withMutationLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = lockTail;
    let unlock!: () => void;
    lockTail = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try { return await operation(); } finally { unlock(); }
  };

  const serviceFor = (id: string) => createMemberService({
    management, organization,
    requirePermission: authorizationFor(id).requireDashboardPermission,
    withMutationLock,
    audit: (event) => { audits.push(event); },
  });

  return {
    roles, users, calls, audits, authorization: authorizationFor(actorId), service: serviceFor(actorId), serviceFor,
    mutations: () => calls.filter(({ method }) => method !== 'GET'),
    signOut: () => { signedIn = false; },
    fail: () => { failRequests = true; },
    failRoleAssignment: () => { failRoleAssignment = true; },
    grantExtraLeadScope: () => { extraLeadScope = true; },
    corruptRolePagination: (userId: string, kind: NonNullable<typeof rolePaginationFault>['kind']) => {
      rolePaginationFault = { userId, kind };
    },
  };
}

test('signed-out requests return 401 without calling the management API', async () => {
  const state = fixture();
  state.signOut();
  assert.deepEqual(await state.authorization.getDashboardAuthContext(), { isAuthenticated: false });
  await assert.rejects(state.authorization.requireDashboardPermission('dashboard:access'), isStatus(401));
  assert.equal(state.calls.length, 0);
});

test('ordinary members and administrators from another organization are denied', async () => {
  for (const actor of ['member', 'outsider']) {
    const state = fixture(actor);
    await assert.rejects(state.authorization.requireDashboardPermission('dashboard:access'), isStatus(403));
    await assert.rejects(state.service.addMember({ email: 'newcomer@example.org', role: 'admin' }), isStatus(403));
    assert.equal(state.mutations().length, 0);
    assert.ok(state.calls.every(({ path }) => !path.includes('another-instance')));
  }
});

test('revocation is checked on the next request instead of trusting a previous session role', async () => {
  const state = fixture();
  assert.equal((await state.authorization.requireDashboardPermission('submissions:manage')).role, 'admin');
  state.roles.set('cwru:admin', []);
  await assert.rejects(state.authorization.requireDashboardPermission('submissions:manage'), isStatus(403));
});

test('suspended accounts fail closed even while their organization roles remain assigned', async () => {
  const state = fixture();
  state.users[0].isSuspended = true;
  await assert.rejects(state.authorization.requireDashboardPermission('dashboard:access'), isStatus(403));
});

test('management outages return 503 rather than authorizing or pretending the user signed out', async () => {
  const state = fixture();
  state.fail();
  await assert.rejects(state.authorization.getDashboardAuthContext(), isStatus(503));
});

test('instance leads can manage submissions and add ordinary members, but cannot assign elevated roles', async () => {
  const state = fixture('lead');
  state.grantExtraLeadScope();
  await state.authorization.requireDashboardPermission('submissions:manage');
  const added = await state.service.addMember({ email: 'NEWCOMER@example.org', role: 'member' });
  assert.equal(added.role, 'member');
  assert.deepEqual(state.roles.get('cwru:newcomer'), []);
  const mutationCount = state.mutations().length;
  await assert.rejects(state.service.addMember({ email: 'outsider@example.org', role: 'admin' }), isStatus(403));
  await assert.rejects(state.service.updateMemberRole('member', { role: 'instance-lead' }), isStatus(403));
  assert.equal(state.mutations().length, mutationCount);
});

test('admin adds an existing tekID user and grants a configured role only within this organization', async () => {
  const state = fixture();
  const member = await state.service.addMember({ email: 'newcomer@example.org', role: 'instance-lead' });
  assert.equal(member.role, 'instance-lead');
  assert.deepEqual(state.roles.get('cwru:newcomer'), ['lead-role']);
  assert.ok(state.mutations().every(({ path }) => path.startsWith('/api/organizations/cwru/')));
  assert.equal(state.audits.length, 1);
});

test('unsupported roles and client-provided organization or role IDs are rejected without writes', async () => {
  const state = fixture();
  for (const input of [
    { email: 'newcomer@example.org', role: 'super-admin' },
    { email: 'newcomer@example.org', role: 'admin', organizationId: 'another-instance' },
    { email: 'newcomer@example.org', role: 'admin', roleId: 'tenant-admin' },
  ]) await assert.rejects(state.service.addMember(input), isStatus(400));
  await assert.rejects(state.service.updateMemberRole('../admin', { role: 'member' }), isStatus(400));
  assert.equal(state.mutations().length, 0);
});

test('an unknown email creates neither an account nor a membership', async () => {
  const state = fixture();
  await assert.rejects(state.service.addMember({ email: 'unknown@example.org', role: 'member' }), isStatus(404));
  assert.equal(state.mutations().length, 0);
});

test('adding an existing member cannot silently replace or downgrade their roles', async () => {
  const state = fixture('lead');
  await assert.rejects(state.service.addMember({ email: 'admin@example.org', role: 'member' }), isStatus(409));
  assert.deepEqual(state.roles.get('cwru:admin'), ['admin-role']);
  assert.equal(state.mutations().length, 0);
});

test('role updates preserve unrelated organization roles and reject users outside this organization', async () => {
  const state = fixture();
  state.roles.set('cwru:lead', ['lead-role', 'events-editor']);
  await state.service.updateMemberRole('lead', { role: 'admin' });
  assert.deepEqual(state.roles.get('cwru:lead'), ['events-editor', 'admin-role']);
  await assert.rejects(state.service.updateMemberRole('outsider', { role: 'admin' }), isStatus(404));
  assert.deepEqual(state.roles.get('another-instance:outsider'), ['admin-role']);
});

test('an administrator cannot revoke their own role', async () => {
  const state = fixture();
  await assert.rejects(state.service.updateMemberRole('admin', { role: 'member' }), isStatus(409));
  assert.deepEqual(state.roles.get('cwru:admin'), ['admin-role']);
  assert.equal(state.mutations().length, 0);
});

test('concurrent administrators cannot demote one another and leave no admin', async () => {
  const state = fixture();
  state.roles.set('cwru:lead', ['admin-role']);
  const outcomes = await Promise.allSettled([
    state.service.updateMemberRole('lead', { role: 'member' }),
    state.serviceFor('lead').updateMemberRole('admin', { role: 'member' }),
  ]);
  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal([...state.roles.entries()].filter(([key, ids]) => key.startsWith('cwru:') && ids.includes('admin-role')).length, 1);
});

test('failed role assignment reports the partial membership instead of claiming a promotion succeeded', async () => {
  const state = fixture();
  state.failRoleAssignment();
  await assert.rejects(state.service.addMember({ email: 'newcomer@example.org', role: 'admin' }), (error) =>
    error instanceof TekidMemberError && error.status === 503 && error.message.includes('member was added'));
  assert.deepEqual(state.roles.get('cwru:newcomer'), []);
});

test('member listing projects only profile fields and instance role', async () => {
  const state = fixture('lead');
  const result = await state.service.listMembers(1);
  assert.deepEqual(result.members.map(({ id }) => id), ['admin', 'lead', 'member']);
  assert.equal(result.page, 1);
  assert.equal(result.hasMore, false);
  assert.deepEqual(Object.keys(result.members[0]).sort(), ['email', 'id', 'name', 'picture', 'role']);
  assert.equal(JSON.stringify(result).includes('passwordDigest'), false);
});

test('mutation requests require the canonical site origin, including rejection of sibling sites', () => {
  const origin = 'https://cwru.wtf';
  assert.doesNotThrow(() => assertSameOriginMutation(new Request(`${origin}/api/admin/members`, {
    method: 'POST', headers: { Origin: origin },
  }), origin));
  for (const other of ['https://another.wtf', 'https://evil.cwru.wtf', 'null', '']) {
    assert.throws(() => assertSameOriginMutation(new Request(`${origin}/api/admin/members`, {
      method: 'POST', headers: other ? { Origin: other } : {},
    }), origin), isStatus(403));
  }
});

test('management transport accepts successful plain-text acknowledgments and still parses JSON reads', async () => {
  const replies = [
    new Response('Created', { status: 201, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }),
    new Response(null, { status: 204 }),
    Response.json([{ id: 'member', name: 'A member' }]),
  ];
  const client = createTekidManagementClient({
    endpoint: 'https://id.example.org/',
    getAccessToken: async () => ({ value: 'isolated-test-token' }),
    fetch: async (url, options) => {
      assert.equal(new URL(String(url)).origin, 'https://id.example.org');
      assert.equal(options?.cache, 'no-store');
      assert.equal(options?.redirect, 'error');
      return replies.shift()!;
    },
  });
  assert.equal((await client.request('POST', '/api/organizations/cwru/users', { body: { userIds: ['member'] } })).data, undefined);
  assert.equal((await client.request('PUT', '/api/organizations/cwru/users/member/roles', { body: { organizationRoleIds: [] } })).data, undefined);
  assert.deepEqual((await client.request('GET', '/api/organizations/cwru/users')).data, [{ id: 'member', name: 'A member' }]);
});

test('a non-JSON authorization read fails closed instead of accepting an acknowledgment as permissions', async () => {
  const client = createTekidManagementClient({
    endpoint: 'https://id.example.org',
    getAccessToken: async () => ({ value: 'isolated-test-token' }),
    fetch: async () => new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
  });
  const authorization = createDashboardAuthorization({
    organization,
    management: client,
    getAuthContext: async () => ({ isAuthenticated: true, claims: claims('admin') }),
  });
  await assert.rejects(authorization.requireDashboardPermission('members:assign-roles'), isStatus(503));
});

test('authorization finds configured admin and lead roles after the first page', async () => {
  for (const actor of ['admin', 'lead'] as const) {
    const state = fixture(actor);
    state.roles.set(`cwru:${actor}`, [
      ...Array.from({ length: 105 }, (_, index) => `other-role-${index}`),
      actor === 'admin' ? 'admin-role' : 'lead-role',
    ]);
    const context = await state.authorization.requireDashboardPermission('dashboard:access');
    assert.equal(context.role, actor === 'admin' ? 'admin' : 'instance-lead');
    assert.ok(state.calls.some(({ path, query }) => path.endsWith(`/${actor}/roles`) && query?.page === '2'));
  }
});

test('role replacement preserves unrelated assignments from every page', async () => {
  const state = fixture();
  const unrelated = Array.from({ length: 205 }, (_, index) => `other-role-${index}`);
  state.roles.set('cwru:lead', ['lead-role', ...unrelated]);
  await state.service.updateMemberRole('lead', { role: 'admin' });
  assert.deepEqual(state.roles.get('cwru:lead'), [...unrelated, 'admin-role']);
  assert.ok(state.calls.some(({ path, query }) => path.endsWith('/lead/roles') && query?.page === '3'));
});

test('admin demotion considers an active replacement beyond the first hundred admin members', async () => {
  const state = fixture();
  const suspendedAdmins = Array.from({ length: 101 }, (_, index) => ({
    ...state.users[0], id: `suspended-${index}`, primaryEmail: `suspended-${index}@example.org`, isSuspended: true,
  }));
  state.users.unshift(...suspendedAdmins);
  for (const user of suspendedAdmins) state.roles.set(`cwru:${user.id}`, ['admin-role']);
  state.roles.set('cwru:lead', ['admin-role']);
  await state.service.updateMemberRole('lead', { role: 'member' });
  assert.deepEqual(state.roles.get('cwru:lead'), []);
  assert.deepEqual(state.roles.get('cwru:admin'), ['admin-role']);
  assert.ok(state.calls.some(({ path, query }) => path === '/api/organizations/cwru/users' &&
    query?.organizationRoleId === 'admin-role' && query.page === '2'));
});

test('malformed, changing, repeated, or truncated role pages never permit a destructive replacement', async () => {
  for (const fault of ['malformed-total', 'changed-total', 'repeated-page', 'truncated-page'] as const) {
    const state = fixture();
    const original = ['lead-role', ...Array.from({ length: 105 }, (_, index) => `other-role-${index}`)];
    state.roles.set('cwru:lead', original);
    state.corruptRolePagination('lead', fault);
    await assert.rejects(state.service.updateMemberRole('lead', { role: 'admin' }),
      (error) => error instanceof TekidManagementError && error.status === 503);
    assert.equal(state.mutations().length, 0);
    assert.deepEqual(state.roles.get('cwru:lead'), original);
  }
});

test('unbounded pagination fails closed at the limit instead of returning a partial role collection', async () => {
  let pageCount = 0;
  const management: TekidManagementClient = {
    async request(_method, _path, options) {
      pageCount += 1;
      const page = options!.query!.page;
      return {
        data: Array.from({ length: 100 }, (_, index) => ({ id: `${page}-${index}` })),
        headers: new Headers(),
      };
    },
  };
  await assert.rejects(listAllManagementItems(management, '/api/organizations/cwru/users/admin/roles',
    (data) => data as { id: string }[]),
  (error) => error instanceof TekidManagementError && error.status === 503);
  assert.equal(pageCount, 100);
});
