export const tekidProfilePath = '/profile';
export const tekidDashboardPath = '/admin';

// Only destinations implemented by this app can be stored in the sign-in session.
export function getTekidReturnPath(value: unknown): typeof tekidProfilePath | typeof tekidDashboardPath {
  return value === tekidDashboardPath ? tekidDashboardPath : tekidProfilePath;
}
