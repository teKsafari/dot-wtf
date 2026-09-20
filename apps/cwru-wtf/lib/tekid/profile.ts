export type TekidProfile = {
  name: string;
  picture: string | null;
};

type ProfileClaims = {
  name?: unknown;
  username?: unknown;
  picture?: unknown;
};

function profileText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function profilePicture(value: unknown): string | null {
  const picture = profileText(value);
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

// Only these display fields may leave the server; never spread token claims.
export function getTekidProfileFromClaims(
  isAuthenticated: boolean,
  claims: ProfileClaims | null | undefined
): TekidProfile | null {
  if (!isAuthenticated || !claims) return null;

  return {
    name: profileText(claims.name) ?? profileText(claims.username) ?? 'Member',
    picture: profilePicture(claims.picture),
  };
}
