import { parseArgs } from 'node:util';
import { createManagementApi } from '@logto/api/management';
import { z } from 'zod';
import { OperatorError, operatorUserIdSchema, readLegacyMembers, type LegacyReader } from './member-operator-logic';

const usage = 'pnpm import:logto-members [--apply]';
const endpoint = 'https://id.teksafari.org';

async function main() {
  let values;
  try {
    ({ values } = parseArgs({ options: { apply: { type: 'boolean', default: false }, help: { type: 'boolean' } }, strict: true, allowPositionals: false }));
  } catch { throw new OperatorError(`Usage: ${usage}`); }
  if (values.help) {
    console.info(`Usage: ${usage}`);
    console.info('Default: read-only plan. --apply imports existing Logto organization members into local PostgreSQL once.');
    console.info('Logto is only read. Prior imports and local membership decisions are never overwritten.');
    return;
  }
  await import('./load-env');
  const config = z.object({
    LOGTO_MANAGEMENT_APP_ID: operatorUserIdSchema,
    LOGTO_MANAGEMENT_APP_SECRET: z.string().refine((value) => value.trim().length > 0),
    LOGTO_ORGANIZATION_ID: operatorUserIdSchema,
    LOGTO_ADMIN_ROLE_ID: operatorUserIdSchema,
    LOGTO_INSTANCE_LEAD_ROLE_ID: operatorUserIdSchema,
  }).safeParse(process.env);
  if (!config.success) throw new OperatorError(`Invalid import-only environment variables: ${[...new Set(config.error.issues.map((issue) => issue.path[0]))].join(', ')}`);
  const environment = config.data;
  if (environment.LOGTO_ADMIN_ROLE_ID === environment.LOGTO_INSTANCE_LEAD_ROLE_ID) throw new OperatorError('Import role IDs must be distinct.');
  const { clientCredentials } = createManagementApi('default', {
    baseUrl: endpoint, apiIndicator: 'https://default.logto.app/api',
    clientId: environment.LOGTO_MANAGEMENT_APP_ID, clientSecret: environment.LOGTO_MANAGEMENT_APP_SECRET,
  });
  const reader: LegacyReader = {
    async get(path, query = {}) {
      const url = new URL(path, endpoint);
      if (!path.startsWith('/api/') || url.origin !== endpoint) throw new OperatorError('Invalid Management API path.');
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      const token = await clientCredentials.getAccessToken();
      const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token.value}` }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new OperatorError(`Could not read Logto migration data (HTTP ${response.status}). No database changes were made.`);
      return { data: await response.json(), total: response.headers.get('total-number') };
    },
  };
  const organizationId = environment.LOGTO_ORGANIZATION_ID;
  const organization = await reader.get(`/api/organizations/${encodeURIComponent(organizationId)}`);
  if (!z.object({ id: z.literal(organizationId) }).safeParse(organization.data).success) throw new OperatorError('Could not verify the source organization.');
  for (const [roleId, expectedName] of [[environment.LOGTO_ADMIN_ROLE_ID, 'dot-wtf:admin'], [environment.LOGTO_INSTANCE_LEAD_ROLE_ID, 'dot-wtf:instance-lead']]) {
    const role = await reader.get(`/api/organization-roles/${encodeURIComponent(roleId!)}`);
    if (!z.object({ id: z.literal(roleId!), name: z.literal(expectedName!), type: z.literal('User') }).safeParse(role.data).success) throw new OperatorError(`The configured import role must be the User organization role ${expectedName}.`);
  }
  const members = await readLegacyMembers(reader, organizationId);
  const { importLegacyMembers, openOperatorDatabase } = await import('./member-operator-database');
  const { database, close } = openOperatorDatabase(process.env.DATABASE_URL);
  try {
    const results = await importLegacyMembers(database, { members, organizationId, adminRoleId: environment.LOGTO_ADMIN_ROLE_ID, instanceLeadRoleId: environment.LOGTO_INSTANCE_LEAD_ROLE_ID, apply: values.apply });
    console.info(values.apply ? 'Import committed to local PostgreSQL.' : 'Dry run only. No database or Logto writes.');
    console.table(results);
    console.info(`Members: ${results.length}; ${values.apply ? 'imported' : 'would import'}: ${results.filter((item) => item.outcome === 'import').length}; already imported: ${results.filter((item) => item.outcome === 'already-imported').length}; preserved local decisions: ${results.filter((item) => item.outcome === 'local-decision').length}.`);
    if (results.some((item) => item.orderingSource === 'createdAt')) console.info('Number ordering uses account createdAt where Logto omits organization join time. It does not reconstruct exact historical join order.');
    console.info('Management API responses do not establish email verification. Existing matching verified local emails are retained; a later sign-in refreshes other identity snapshots.');
  } finally { await close(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof OperatorError ? error.message : 'Membership import failed. Check import-only configuration, database migrations, and Logto access. No partial database import was committed.');
  process.exitCode = 1;
});
