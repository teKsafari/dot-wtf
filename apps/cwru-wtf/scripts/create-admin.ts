import { parseArgs } from 'node:util';
import { z } from 'zod';
import { OperatorError, operatorUserIdSchema } from './member-operator-logic';

const usage = 'pnpm create-admin (--email member@example.org | --user-id tekid-user-id) --role admin|instance-lead [--dry-run]';

async function main() {
  let values;
  try {
    ({ values } = parseArgs({ options: {
      email: { type: 'string' }, 'user-id': { type: 'string' }, role: { type: 'string' },
      'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean' },
    }, strict: true, allowPositionals: false }));
  } catch { throw new OperatorError(`Usage: ${usage}`); }
  if (values.help) {
    console.info(`Usage: ${usage}`);
    console.info('Grants a role to an existing verified local profile. Reads and writes PostgreSQL only.');
    console.info('This trusted bootstrap command can approve an incomplete profile; use the dashboard for routine review.');
    return;
  }
  const input = z.object({
    email: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
    'user-id': operatorUserIdSchema.optional(), role: z.enum(['admin', 'instance-lead']), 'dry-run': z.boolean(),
  }).refine((value) => Boolean(value.email) !== Boolean(value['user-id'])).safeParse(values);
  if (!input.success) throw new OperatorError(`Usage: ${usage}`);
  await import('./load-env');
  const { bootstrapLocalMember, openOperatorDatabase } = await import('./member-operator-database');
  const { database, close } = openOperatorDatabase(process.env.DATABASE_URL);
  try {
    const result = await bootstrapLocalMember(database, { email: input.data.email, userId: input.data['user-id'], role: input.data.role, dryRun: input.data['dry-run'] });
    console.info(`${result.dryRun ? 'Dry run: would ensure' : result.unchanged ? 'Already configured:' : 'Granted'} local ${input.data.role} for user ${result.userId}${result.number === null ? ' with an automatic member number' : `, member #${result.number}`}.`);
  } finally { await close(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof OperatorError ? error.message : 'Local role setup failed. Check DATABASE_URL and migrations; no Logto permissions were changed.');
  process.exitCode = 1;
});
