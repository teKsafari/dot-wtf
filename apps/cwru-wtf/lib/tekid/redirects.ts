export const tekidProfilePath = '/profile';
export const tekidDashboardPath = '/admin';
export const tekidMembersPath = '/members';

type TekidReturnPath = typeof tekidProfilePath | typeof tekidDashboardPath | typeof tekidMembersPath;

// Only destinations implemented by this app can be stored in the sign-in session.
export function getTekidReturnPath(value: unknown): TekidReturnPath {
  return value === tekidDashboardPath || value === tekidMembersPath ? value : tekidProfilePath;
}
