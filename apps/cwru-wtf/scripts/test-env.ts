// Tests use isolated dummy configuration and never load a developer's .env files.
export const testEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
  LOGTO_APP_ID: 'test-app',
  LOGTO_APP_SECRET: 'test-app-secret',
  LOGTO_BASE_URL: 'http://dot-wtf.localhost:1355',
  LOGTO_COOKIE_SECRET: 'test-cookie-secret-at-least-32-characters',
  LOGTO_MANAGEMENT_APP_ID: 'test-management-app',
  LOGTO_MANAGEMENT_APP_SECRET: 'test-management-app-secret',
  LOGTO_ORGANIZATION_ID: 'test-organization',
  LOGTO_ADMIN_ROLE_ID: 'test-admin-role',
  LOGTO_INSTANCE_LEAD_ROLE_ID: 'test-instance-lead-role',
} as const;

Object.assign(process.env, testEnvironment);

for (const name of ['TALLY_WEBHOOK_SECRET', 'TALLY_FORM_ID', 'TALLY_FIELD_KEYS']) {
  delete process.env[name];
}
