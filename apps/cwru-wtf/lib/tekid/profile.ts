import type { AuthContextType, AuthSession, RequiredProfileClaim } from './types';

type ProfileClaims = Partial<Record<keyof AuthSession, unknown>>;

export class TekidProfileContractError extends Error {
  constructor(readonly field: RequiredProfileClaim | 'claims') {
    // Keep profile values and tokens out of error messages.
    super(`tekID profile contract requires a valid ${field}`);
    this.name = 'TekidProfileContractError';
  }
}

function requiredText(value: unknown, field: 'sub' | 'name' | 'email'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TekidProfileContractError(field);
  }

  return value;
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new TekidProfileContractError('email_verified');
  }

  return value;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function profilePicture(value: unknown): string | null {
  const picture = optionalText(value);
  if (!picture) return null;

  try {
    const url = new URL(picture);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

// Validate once, then project the application fields without spreading raw claims.
export function getTekidAuthContextFromClaims(
  isAuthenticated: boolean,
  claims: ProfileClaims | null | undefined
): AuthContextType {
  if (!isAuthenticated) return { isAuthenticated: false, claims: null };
  if (!claims) throw new TekidProfileContractError('claims');

  return {
    isAuthenticated: true,
    claims: {
      sub: requiredText(claims.sub, 'sub'),
      name: requiredText(claims.name, 'name'),
      username: optionalText(claims.username),
      email: requiredText(claims.email, 'email'),
      email_verified: requiredBoolean(claims.email_verified),
      picture: profilePicture(claims.picture),
    },
  };
}
