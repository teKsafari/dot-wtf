# Moving membership and roles to PostgreSQL

Logto continues to authenticate accounts. This release moves membership status, dashboard roles, application review, and member numbers into `member_profiles`. The application no longer reads the Logto Management API to authorize requests.

## Prepare and review

1. Back up the database and confirm which database `DATABASE_URL` targets. Keep operator configuration and any export outside the repository.
2. Pause membership and role changes during the snapshot and cutover. Logto does not offer this importer a transactional snapshot across paginated reads. The importer rejects changed totals and duplicate pages, but a same-size concurrent replacement cannot always be detected.
3. Apply all outstanding migrations in order to the intended database before using these tools (`pnpm db:migrate`). `0011_local_membership` adds local membership fields, the number counter, and audit records. The earlier `0009` migration already removed the obsolete password-admin table. Review the migrations and backup before a production run.
4. In the operator environment only, configure `DATABASE_URL`, `LOGTO_MANAGEMENT_APP_ID`, `LOGTO_MANAGEMENT_APP_SECRET`, `LOGTO_ORGANIZATION_ID`, `LOGTO_ADMIN_ROLE_ID`, and `LOGTO_INSTANCE_LEAD_ROLE_ID`. The two IDs must identify distinct User organization roles named `dot-wtf:admin` and `dot-wtf:instance-lead`. The importer verifies these identities before planning.
5. From `apps/cwru-wtf`, run the default dry run:

```bash
pnpm import:logto-members
```

The default mode reads Logto and PostgreSQL without changing their data. It lists user IDs, outcomes, local roles/statuses, proposed numbers, and the source of ordering. Review the expected member and administrator counts. `already-imported` preserves that account's current state; `local-decision` preserves an account that has already entered the local review process or has a prior local membership decision.

## Apply once, then verify

Only after approving the reviewed migration target and import plan:

```bash
pnpm import:logto-members --apply
```

All profile changes, number allocations, and import audit markers commit in one PostgreSQL transaction under the same advisory lock used by dashboard membership mutations. A failed transaction leaves no partial import. The tool only makes GET requests to the Logto Management API; OAuth token retrieval is the only remote POST and does not change membership.

Active legacy members become locally approved, suspended legacy accounts stay suspended, and recognized admin/instance-lead roles are preserved. Unknown Logto organization roles do not become local privileges. An imported account can retain membership without completing the new application; this is the one-time preservation of existing members, not automatic approval of a new applicant.

Existing local profile answers are preserved. New rows receive a Logto name/email/photo snapshot. The Management API's `primaryEmail` does not establish the application's `email_verified` claim, so the import does not invent verification. An existing verified local email is retained only when it matches the snapshot. Later authenticated profile visits refresh identity claims and can hydrate historical application answers through the normal verified-email flow.

Every processed account gets a durable `member.import-logto` audit marker, including accounts skipped for a local decision. Reruns skip these markers even if the profile was subsequently suspended, demoted, or deleted. A local decision also blocks import before a marker exists. Do not delete import audit records or rerun an older migration that overwrites local state. Later Logto organization or role changes do not synchronize back into this app; use the dashboard.

Run the dry-run command again to confirm no already-processed accounts would be imported, then verify:

- An imported admin and an instance lead can open the local dashboard; an ordinary member cannot.
- Approved accounts can use the directory; draft, pending, rejected, and suspended accounts cannot.
- A new complete application remains pending until reviewed. Custom-number conflicts are reported, and automatic numbers remain unique.
- A local role revocation takes effect on the next protected request and remains revoked after another dry run/import.

Deploy the code with only the four Logto sign-in variables and `DATABASE_URL`; remove import-only Management API and organization/role variables from the deployed runtime. Keep the import tool an operator task. The legacy Tally webhook and direct submission endpoint return 410; `/join` directs people to their profile.

## Numbering and historical order

The importer sorts newly imported accounts by organization `joinedAt` when the API provides it; otherwise it uses the account's `createdAt`, breaking equal timestamps by user ID. The installed Logto API currently omits organization join timestamps. **Account creation order is only an approximation of historical membership order.** The dry-run output names the fallback so an operator can review it before applying.

Already assigned local numbers are preserved. Unimported accounts receive the next numbers after the current counter/maximum; the importer never renumbers existing members to recreate a global historical order. For imported rows without a join timestamp, `approvedAt` records the import time instead of pretending account creation was approval. An admin can assign available custom numbers after review. Supported numbers are 1 through 2,147,483,646; the following integer is reserved for the allocator's counter.

## Bootstrap and recovery

If there is no usable imported administrator, the intended operator must first sign in with a verified email and visit `/profile` to create a local row:

```bash
pnpm create-admin --user-id tekid-user-id --role admin --dry-run
pnpm create-admin --user-id tekid-user-id --role admin
```

`--email` is an alternative and must match exactly one local profile case-insensitively. This command uses PostgreSQL only, approves the verified profile, allocates a number if needed, and records `member.bootstrap`. It does not require Logto Management API credentials. It refuses suspended/rejected accounts and administrator demotion. Bootstrap is an explicit trusted-operator exception to complete-application review, so choose the target deliberately.

Rollback requires an operator decision: rolling back code alone would restore remote authorization and ignore later local revocations. Preserve the database backup and audit records, pause local review before rollback, and reconcile all membership/role changes made after cutover. Do not drop local membership tables or purge audit markers as a routine rollback step.

## Isolated operator verification

`pnpm test:operators` always runs the pure fixtures. To also run the PostgreSQL cases, supply `OPERATOR_TEST_DATABASE_URL` pointing to a separate disposable loopback database named `dot_wtf_operator_service_test`. The guard accepts only `postgres`/`postgresql`, `127.0.0.1` or `localhost`, a `dot_wtf_*_test` database name, and no query or fragment. The tests apply repository migrations and reset their fixture tables. They never load `.env` or infer a target from `DATABASE_URL`. Do not share this database with the profile/member integration suites.

The database cases verify zero mutations during dry runs, atomic ordered imports, preserved profile answers, durable protection against regranting revoked/deleted accounts, preserved local decisions, rollback on number exhaustion, and idempotent local bootstrap.
