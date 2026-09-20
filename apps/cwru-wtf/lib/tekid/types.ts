import type { IdTokenClaims } from '@logto/next';

type RequiredProfileClaim = 'sub' | 'name' | 'username' | 'email' | 'email_verified';

type NonNullableProps<T> = {
  [Key in keyof T]-?: NonNullable<T[Key]>;
};

// tekID's application contract is stricter than the generic OIDC claim types.
export type AuthSession = NonNullableProps<Pick<IdTokenClaims, RequiredProfileClaim>> & {
  picture: string | null;
};

export type AuthContextType =
  | { isAuthenticated: true; claims: AuthSession }
  | { isAuthenticated: false; claims: null };
