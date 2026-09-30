import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createManagementApi } from '@logto/api/management';
import { z } from 'zod';
import { OperatorError, operatorUserIdSchema } from './member-operator-logic';

const usage = 'pnpm sync:logto-branding [--apply]';
const endpoint = 'https://id.teksafari.org';
const applicationName = 'dot-wtf';
const faviconUrl = 'https://dott.wtf/icon.svg';

const signInExperienceSchema = z.object({
  branding: z.object({ logoUrl: z.string().nullish(), darkLogoUrl: z.string().nullish(), favicon: z.string().nullish(), darkFavicon: z.string().nullish() }).passthrough(),
  customCss: z.string().nullish(),
}).passthrough();
type SignInExperience = z.infer<typeof signInExperienceSchema>;

async function main() {
  let values;
  try {
    ({ values } = parseArgs({ options: { apply: { type: 'boolean', default: false }, help: { type: 'boolean' } }, strict: true, allowPositionals: false }));
  } catch { throw new OperatorError(`Usage: ${usage}`); }
  if (values.help) {
    console.info(`Usage: ${usage}`);
    console.info('Default: read-only plan. --apply sets the dot-wtf app\'s logo fields, favicons, and CSS override in Logto from this repository.');
    console.info('Both logo fields take public/dot-wtf-wordmark.svg, because the sign-in canvas is always light. The CSS override takes docs/tekid-sign-in.css.');
    return;
  }
  await import('./load-env');
  const config = z.object({
    LOGTO_APP_ID: operatorUserIdSchema,
    LOGTO_MANAGEMENT_APP_ID: operatorUserIdSchema,
    LOGTO_MANAGEMENT_APP_SECRET: z.string().refine((value) => value.trim().length > 0),
  }).safeParse(process.env);
  if (!config.success) throw new OperatorError(`Invalid branding sync environment variables: ${[...new Set(config.error.issues.map((issue) => issue.path[0]))].join(', ')}`);
  const environment = config.data;
  const { clientCredentials } = createManagementApi('default', {
    baseUrl: endpoint, apiIndicator: 'https://default.logto.app/api',
    clientId: environment.LOGTO_MANAGEMENT_APP_ID, clientSecret: environment.LOGTO_MANAGEMENT_APP_SECRET,
  });
  async function request(method: 'GET' | 'PUT', path: string, body?: unknown): Promise<unknown> {
    const token = await clientCredentials.getAccessToken();
    const response = await fetch(new URL(path, endpoint), {
      method, headers: { Authorization: `Bearer ${token.value}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new OperatorError(`Logto ${method} ${path} failed (HTTP ${response.status}).`);
    return response.json();
  }

  const applicationPath = `/api/applications/${encodeURIComponent(environment.LOGTO_APP_ID)}`;
  const application = z.object({ name: z.string() }).parse(await request('GET', applicationPath));
  if (application.name !== applicationName) throw new OperatorError(`LOGTO_APP_ID names the application "${application.name}", not ${applicationName}. Nothing was changed.`);
  const read = async () => signInExperienceSchema.parse(await request('GET', `${applicationPath}/sign-in-experience`));
  const live = await read();

  const logo = `data:image/svg+xml,${encodeURIComponent(readFileSync('public/dot-wtf-wordmark.svg', 'utf8').trimEnd())}`;
  const wanted = { logoUrl: logo, darkLogoUrl: logo, favicon: faviconUrl, darkFavicon: faviconUrl, customCss: readFileSync('docs/tekid-sign-in.css', 'utf8') };
  const current = (experience: SignInExperience) => ({ ...experience.branding, customCss: experience.customCss });
  const changes = (experience: SignInExperience) => (Object.keys(wanted) as (keyof typeof wanted)[]).filter((field) => current(experience)[field] !== wanted[field]);

  const pending = changes(live);
  console.table(Object.keys(wanted).map((field) => ({ field, status: pending.includes(field as keyof typeof wanted) ? (values.apply ? 'updated' : 'will update') : 'up to date' })));
  if (pending.includes('customCss') && live.customCss) {
    const liveLines = new Set(live.customCss.split('\n'));
    const repoLines = new Set(wanted.customCss.split('\n'));
    console.info(`The live CSS has ${[...liveLines].filter((line) => !repoLines.has(line)).length} lines not in docs/tekid-sign-in.css, which --apply replaces, and lacks ${[...repoLines].filter((line) => !liveLines.has(line)).length} of its lines.`);
  }
  if (!values.apply) {
    console.info(pending.length ? 'Dry run only. No Logto writes. Run with --apply to update.' : 'Logto already matches this repository.');
    return;
  }
  if (!pending.length) {
    console.info('Logto already matches this repository. Nothing was written.');
    return;
  }

  const { customCss, ...branding } = wanted;
  const { tenantId: _tenantId, applicationId: _applicationId, ...editable } = live;
  await request('PUT', `${applicationPath}/sign-in-experience`, { ...editable, branding: { ...live.branding, ...branding }, customCss });
  const remaining = changes(await read());
  if (remaining.length) throw new OperatorError(`Logto did not keep: ${remaining.join(', ')}.`);
  console.info('Logto now matches this repository. Other sign-in experience settings are unchanged.');
}

main().catch((error: unknown) => {
  console.error(error instanceof OperatorError ? error.message : 'Branding sync failed. Check the Management API credentials and Logto access.');
  process.exitCode = 1;
});
