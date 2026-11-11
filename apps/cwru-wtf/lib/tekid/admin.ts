// The tekID (Pocket ID) admin API. Sign-in stays in the OpenID Connect modules
// beside this one; this client only creates the account that approval mints.
//
// Verified against https://auth.mules.wtf on 2026-11-11:
//   POST   /api/users                              -> 201 {id,...}; 409 {"code":"already_in_use"} on a repeated email
//   POST   /api/users/<id>/one-time-access-token   -> 201 {"token":"<12 chars>"} for {"ttl":"12h"}
//   GET    /api/user-groups                        -> 200 {"data":[...]}
//   PUT    /api/users/<id>/user-groups             -> replaces the user's groups
//   DELETE /api/users/<id>                         -> 204
// A missing path answers 404 with a JSON body, but a proxy or a login page can
// answer 200 with HTML, so every response is checked for JSON before it is read.

export interface TekidUser {
  id: string;
  username: string;
  email: string | null;
}

export interface TekidUserGroup {
  id: string;
  name: string;
}

export interface CreateTekidUserInput {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface TekidAdminClient {
  createUser(input: CreateTekidUserInput): Promise<TekidUser>;
  deleteUser(id: string): Promise<void>;
  findGroupByName(name: string): Promise<TekidUserGroup | null>;
  createGroup(name: string): Promise<TekidUserGroup>;
  setUserGroups(userId: string, groupIds: string[]): Promise<void>;
  createOneTimeAccessToken(userId: string, ttl: string): Promise<string>;
  signInLink(token: string): string;
}

export class TekidAdminError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string
  ) {
    super(message);
    this.name = 'TekidAdminError';
  }
}

export const tekidEmailInUse = 'already_in_use';

type Json = Record<string, unknown>;

export function createTekidAdminClient(options: {
  baseUrl: string;
  apiKey: string;
  fetchImplementation?: typeof fetch;
  timeoutMilliseconds?: number;
}): TekidAdminClient {
  const call = options.fetchImplementation ?? fetch;
  const timeout = options.timeoutMilliseconds ?? 10_000;

  async function request(method: string, path: string, body?: Json): Promise<unknown> {
    let response: Response;
    try {
      response = await call(new URL(path, options.baseUrl).href, {
        method,
        headers: {
          'X-API-KEY': options.apiKey,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
        cache: 'no-store',
      });
    } catch {
      // Never repeat the key, the path, or the applicant's values in an error.
      throw new TekidAdminError(0, null, 'The Club ID service did not answer.');
    }

    if (response.status === 204) return null;

    const contentType = response.headers.get('content-type') ?? '';
    // A status alone lies here: a proxy or the login page answers 200 with HTML.
    if (!contentType.includes('application/json')) {
      await response.body?.cancel();
      throw new TekidAdminError(response.status, null, 'The Club ID service answered with something other than its API.');
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = (payload ?? {}) as Json;
      const code = typeof error.code === 'string' ? error.code : null;
      throw new TekidAdminError(response.status, code, `The Club ID service rejected the request (${response.status}).`);
    }
    return payload;
  }

  function asUser(payload: unknown): TekidUser {
    const user = (payload ?? {}) as Json;
    if (typeof user.id !== 'string' || !user.id) {
      throw new TekidAdminError(200, null, 'The Club ID service returned an account without an id.');
    }
    return {
      id: user.id,
      username: typeof user.username === 'string' ? user.username : '',
      email: typeof user.email === 'string' ? user.email : null,
    };
  }

  function asGroup(payload: unknown): TekidUserGroup {
    const group = (payload ?? {}) as Json;
    if (typeof group.id !== 'string' || !group.id) {
      throw new TekidAdminError(200, null, 'The Club ID service returned a group without an id.');
    }
    return { id: group.id, name: typeof group.name === 'string' ? group.name : '' };
  }

  return {
    async createUser(input) {
      return asUser(await request('POST', '/api/users', { ...input, isAdmin: false }));
    },
    async deleteUser(id) {
      await request('DELETE', `/api/users/${encodeURIComponent(id)}`);
    },
    async findGroupByName(name) {
      const payload = (await request('GET', '/api/user-groups')) as Json | null;
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const match = data.find((entry) =>
        typeof entry === 'object' && entry !== null && (entry as Json).name === name);
      return match ? asGroup(match) : null;
    },
    async createGroup(name) {
      return asGroup(await request('POST', '/api/user-groups', { name, friendlyName: name }));
    },
    async setUserGroups(userId, groupIds) {
      await request('PUT', `/api/users/${encodeURIComponent(userId)}/user-groups`, { userGroupIds: groupIds });
    },
    async createOneTimeAccessToken(userId, ttl) {
      // ttl, not expiresAt: expiresAt is accepted and ignored, and the link that
      // comes back is a short 6-character token instead of the 12-character one.
      const payload = (await request('POST', `/api/users/${encodeURIComponent(userId)}/one-time-access-token`, { ttl })) as Json | null;
      const token = payload?.token;
      if (typeof token !== 'string' || !token) {
        throw new TekidAdminError(200, null, 'The Club ID service returned no sign-in token.');
      }
      return token;
    },
    signInLink(token) {
      return new URL(`/lc/${token}`, options.baseUrl).href;
    },
  };
}

// '12h' and '45m' are what the API takes; the reviewer is shown a real instant.
export function expiryFromTtl(ttl: string, from: Date): Date {
  const match = /^([1-9][0-9]{0,3})([smhd])$/.exec(ttl);
  if (!match) throw new Error('Invalid sign-in link lifetime.');
  const seconds = { s: 1, m: 60, h: 3600, d: 86_400 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return new Date(from.getTime() + Number(match[1]) * seconds * 1000);
}
