import type { IdTokenClaims } from '@logto/next';

export type RequiredProfileClaim = 'sub' | 'name' | 'email' | 'email_verified';

type NonNullableProps<T> = {
  [Key in keyof T]-?: NonNullable<T[Key]>;
};

// tekID's application contract is stricter than the generic OIDC claim types.
export type AuthSession = NonNullableProps<Pick<IdTokenClaims, RequiredProfileClaim>> & {
  // The display name is required; the separate username may be unassigned.
  username: string | null;
  picture: string | null;
};

export type AuthContextType =
  | { isAuthenticated: true; claims: AuthSession }
  | { isAuthenticated: false; claims: null };
