import type { AuthSession } from './types';

type ClaimRecord = Record<string, unknown>;

// Pocket ID spells the optional username `preferred_username`; this application calls it
// `username`. Every other field is already a standard OIDC claim name. The subject comes
// from the ID token alone, and profile.ts validates the result before anything reads it.
export function tekidClaimsFromProfile(
  idTokenClaims: ClaimRecord,
  userInfo: ClaimRecord = {}
): Partial<Record<keyof AuthSession, unknown>> {
  const profile = { ...idTokenClaims, ...userInfo };
  const username = profile.preferred_username ?? profile.username;

  return {
    sub: idTokenClaims.sub,
    name: profile.name,
    username: username === undefined ? null : username,
    email: profile.email,
    email_verified: profile.email_verified,
    picture: profile.picture,
  };
}
