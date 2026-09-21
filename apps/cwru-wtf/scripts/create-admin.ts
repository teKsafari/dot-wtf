import { parseArgs } from 'node:util';
import { createManagementApi } from '@logto/api/management';
import { z } from 'zod';

const usage = 'pnpm create-admin --email member@example.org --role admin|instance-lead';

class BootstrapError extends Error {}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        email: { type: 'string' },
        role: { type: 'string' },
        help: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new BootstrapError(`Usage: ${usage}`);
  }

  if (values.help) {
    console.info(`Usage: ${usage}`);
    console.info('Adds an existing tekID user to this organization and grants the selected role.');
    console.info('Existing memberships and roles are preserved. No account or password is created.');
    return;
  }

  const input = z.object({
    email: z.string().trim().email().transform((value) => value.toLowerCase()),
    role: z.enum(['admin', 'instance-lead']),
  }).safeParse(values);

  if (!input.success) throw new BootstrapError(`Usage: ${usage}`);

  // Match Next.js environment loading before validating the shared configuration.
  await import('./load-env');
  const { env } = await import('../env');
  const { apiClient } = createManagementApi('default', {
    baseUrl: 'https://id.teksafari.org',
    apiIndicator: 'https://default.logto.app/api',
    clientId: env.LOGTO_MANAGEMENT_APP_ID,
    clientSecret: env.LOGTO_MANAGEMENT_APP_SECRET,
  });
  const { email, role } = input.data;
  const organizationId = env.LOGTO_ORGANIZATION_ID;
  const roleId = role === 'admin' ? env.LOGTO_ADMIN_ROLE_ID : env.LOGTO_INSTANCE_LEAD_ROLE_ID;

  const organization = await apiClient.GET('/api/organizations/{id}', {
    params: { path: { id: organizationId } },
    cache: 'no-store',
  });
  if (!organization.response.ok || !organization.data) {
    throw new BootstrapError('Could not verify the configured organization. No changes were made.');
  }

  const organizationRole = await apiClient.GET('/api/organization-roles/{id}', {
    params: { path: { id: roleId } },
    cache: 'no-store',
  });
  if (
    !organizationRole.response.ok ||
    organizationRole.data?.type !== 'User' ||
    organizationRole.data.name !== role
  ) {
    throw new BootstrapError('The configured role must be the matching User organization role. No changes were made.');
  }

  const users = await apiClient.GET('/api/users', {
    // Logto's search parameters are dotted top-level keys, not a nested query object.
    querySerializer: () => new URLSearchParams({
      'search.primaryEmail': email,
      'mode.primaryEmail': 'exact',
      isCaseSensitive: 'false',
      page: '1',
      page_size: '2',
    }).toString(),
    cache: 'no-store',
  });
  if (!users.response.ok || !users.data) {
    throw new BootstrapError('Could not look up the tekID account. No changes were made.');
  }

  const user = users.data[0];
  if (!user || user.primaryEmail?.toLowerCase() !== email) {
    throw new BootstrapError('No exact primary-email match was found. The member must create a tekID account first.');
  }
  if (users.data.length !== 1) {
    throw new BootstrapError('More than one account matched this email. Resolve the ambiguity in Logto before assigning a role.');
  }
  if (user.isSuspended) {
    throw new BootstrapError('This tekID account is suspended. No changes were made.');
  }

  const membership = await apiClient.POST('/api/organizations/{id}/users', {
    params: { path: { id: organizationId } },
    body: { userIds: [user.id] },
    parseAs: 'text',
  });
  if (!membership.response.ok) {
    throw new BootstrapError('Could not add organization membership. No role was granted.');
  }

  const assignment = await apiClient.POST('/api/organizations/{id}/users/{userId}/roles', {
    params: { path: { id: organizationId, userId: user.id } },
    body: { organizationRoleIds: [roleId] },
    parseAs: 'text',
  });
  if (!assignment.response.ok) {
    throw new BootstrapError('Organization membership is present, but the role could not be granted. Fix the configuration and rerun this command.');
  }

  let verified = false;
  for (let page = 1; page <= 100; page++) {
    const assignedRoles = await apiClient.GET('/api/organizations/{id}/users/{userId}/roles', {
      params: {
        path: { id: organizationId, userId: user.id },
        query: { page, page_size: 100 },
      },
      cache: 'no-store',
    });
    if (!assignedRoles.response.ok || !assignedRoles.data) break;
    if (assignedRoles.data.some((assignedRole) => assignedRole.id === roleId)) {
      verified = true;
      break;
    }
    if (assignedRoles.data.length < 100) break;
  }
  if (!verified) {
    throw new BootstrapError('The API accepted the assignment, but the role could not be verified. Check the organization in Logto before retrying.');
  }

  console.info(`Granted ${role} to tekID user ${user.id} in organization ${organizationId}.`);
}

main().catch((error: unknown) => {
  // Never print SDK errors, request objects, or credentials from the environment.
  console.error(error instanceof BootstrapError ? error.message : 'Role setup failed. Check environment configuration and Management API access.');
  process.exitCode = 1;
});
