export type RequiredProfileClaim = 'sub' | 'name' | 'email' | 'email_verified';

// tekID's application contract is stricter than the generic OIDC claim types.
export type AuthSession = {
  sub: string;
  name: string;
  email: string;
  email_verified: boolean;
  // The display name is required; the separate username may be unassigned.
  username: string | null;
  picture: string | null;
};

export type AuthContextType =
  | { isAuthenticated: true; claims: AuthSession }
  | { isAuthenticated: false; claims: null };
