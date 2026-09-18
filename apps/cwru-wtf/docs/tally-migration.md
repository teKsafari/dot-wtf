# Tally application migration and webhook runbook

The published application form is `https://tally.so/r/lbp7OX`. The home page
embeds the same form, and the previous local submission endpoint returns `410`.
Tally is the applicant-facing form; the local `submissions` table remains the
admin dashboard's data source once the webhook is connected.

## Migration completed on 2026-09-18

The migration exported every local row where `archived_at IS NULL` in a
read-only transaction. It recreated those applications as ordinary responses
in the published Tally form while the webhook and notifications were disabled.
This avoided inserting duplicate rows into the local database.

- The database still contains all 43 original rows: 37 active and 6 archived.
- Tally contains the 37 active applications: 36 approved and 1 waitlisted.
- The 6 archived applications were intentionally excluded from Tally.
- Migration `0007_parched_nico_minoru.sql` is applied in production. It only
  adds nullable `tally_submission_id` and its unique constraint; it does not
  change existing row values.
- The source record-set SHA-256 is
  `b48f3b0ecb138ae71083f8cd57b47b34bc66bb6ef26458d69a2b1d72c5ecb4cd`.
- The final live Tally table has 37 distinct response IDs. Every
  `legacy_record_json` parses to the exact source record, and the visible name,
  email, category set, Other answer, idea, project, video, and usable phone
  digits were reconciled with the source.

Sixteen superseded responses with incorrectly entered phone values are in
Tally's recoverable Trash. Their corrected replacements are in the 37-row live
table. Do not restore the superseded responses.

Tally's `Submitted at` value is the time Tally received the recreated response
on 2026-09-18. It is not the application's historical creation time. The exact
source timestamps, decision, and values remain in the migration metadata and
the unchanged local database.

Each recreated response carries these hidden fields:

| Hidden field | Preserved value |
| --- | --- |
| `legacy_submission_id` | Original local submission ID |
| `legacy_created_at` | Original PostgreSQL creation timestamp text |
| `legacy_updated_at` | Original PostgreSQL update timestamp text |
| `legacy_review_status` | `pending`, `approved`, or `waitlist` |
| `legacy_interests` | Optional legacy interests; source null may be blank or `null` |
| `migration_source` | `cwru-wtf-legacy-2026-09-18` |
| `legacy_record_json` | Lossless JSON for the complete exported source record |

Missing legacy phone values and the two unusable historical phone strings are
blank in the normal Tally phone question. Their exact originals remain in
`legacy_record_json`. Other literal source values, including `-`, are values and
must not be converted to null.

The private migration journal maps every original ID to the final Tally
response ID. Keep that journal and the reconciliation audit private; neither
belongs in source control.

## Export a new source snapshot

`scripts/export-tally-migration.ts` creates a private snapshot of every active
application and no archived applications. It never writes to the database or
uploads data. The transaction is explicitly read-only.

Choose a private output directory outside the repository:

```sh
pnpm tally:export \
  --output-dir /secure/private/cwru-tally-export-2026-09-18
```

The script loads `.env` from this application by default. Select another file
when needed:

```sh
pnpm tally:export \
  --env-file /absolute/path/to/source.env \
  --output-dir /secure/private/cwru-tally-export-2026-09-18
```

The output directory is mandatory and cannot resolve inside the repository,
including through a symlink. The exporter refuses to overwrite its files and
creates each one with mode `0600`:

- `tally-submissions.json`: lossless structured records
- `tally-submissions.csv`: migration-oriented tabular records
- `tally-export-manifest.json`: counts, schema version, sizes, and SHA-256 hashes

The files contain applicant data. Restrict the directory to the migration
operator and delete the files after the rollback window.

The manifest records export schema
`cwru-wtf.tally-migration-export.v1`, the selection predicate, status counts,
the canonical record-set hash, and hashes for both data files. Verify file
hashes without printing their contents:

```sh
cd /secure/private/cwru-tally-export-2026-09-18
shasum -a 256 tally-submissions.json tally-submissions.csv
```

## Configure the webhook

The production endpoint is `POST /api/tally/webhook`. Configure Tally to send
`FORM_RESPONSE` events to the deployed URL and set these environment variables
on the deployment:

- `TALLY_FORM_ID`: the expected form ID, currently `lbp7OX`
- `TALLY_WEBHOOK_SECRET`: the signing secret configured for the Tally webhook
- `TALLY_FIELD_KEYS`: one-line JSON containing the eight question keys and the
  category option ID for Other

Copy question keys from a real official webhook payload's `data.fields[].key`.
Copy `otherCategoryOptionId` from the categories field's `options[].id`. Labels
and option text are editable display values and must not be used as identifiers.
If a Tally block is recreated, update its configured key before reconnecting
the webhook.

```json
{
  "name": "replace-with-name-question-key",
  "email": "replace-with-email-question-key",
  "whatsapp": "replace-with-whatsapp-question-key",
  "categories": "replace-with-categories-question-key",
  "otherCategory": "replace-with-other-category-question-key",
  "wtfIdea": "replace-with-idea-question-key",
  "currentProject": "replace-with-project-question-key",
  "youtubeLink": "replace-with-video-question-key",
  "otherCategoryOptionId": "replace-with-other-option-id"
}
```

All eight question keys must be present, non-empty, and unique. Missing or
invalid configuration makes the endpoint return `503` so Tally can retry.

The live form must retain the field types expected by the parser:

| Configuration key | Tally webhook field type |
| --- | --- |
| `name` | `INPUT_TEXT` |
| `email` | `INPUT_EMAIL` |
| `whatsapp` | `INPUT_PHONE_NUMBER` |
| `categories` | `CHECKBOXES` |
| `otherCategory` | conditional `INPUT_TEXT` |
| `wtfIdea` | `TEXTAREA` |
| `currentProject` | `TEXTAREA` |
| `youtubeLink` | `INPUT_LINK` |

The route verifies `Tally-Signature`, rejects bodies over 1 MB, accepts only the
configured form and `FORM_RESPONSE`, and revalidates the applicant fields. It
requires a `@case.edu` email, 8-15 phone digits, at least one category, an Other
answer when Other is selected, idea and project answers of at most 600
characters, and an HTTP(S) video URL.

A new response is inserted as pending and unarchived using Tally's
`data.createdAt`. `tally_submission_id` makes retries idempotent. A distinct
Tally response using any email already present in the local table is
acknowledged as `duplicate_email` and is not inserted. This applies even when
the existing row is archived, approved, or waitlisted.

The form ID also appears in `components/tally-application-form.tsx` and the
legacy response in `app/api/submissions/route.ts`. Update those locations with
`TALLY_FORM_ID` if the published form changes.

Tally's dark theme, Nunito typography, Klariti mark, duplicate protection, and
required-question settings live inside Tally. Host-page CSS cannot style the
cross-origin form contents.

## Release checklist

- Replace every placeholder in `TALLY_FIELD_KEYS` with the live form's machine
  identifiers and set all three Tally variables in the deployment.
- Deploy migration `0007`, the embed, and the webhook route together. Migration
  `0007` is already applied to the current production database.
- Add the deployed webhook URL in Tally only after the route and environment are
  live. Keep respondent and self-notifications disabled unless the team chooses
  to enable them deliberately.
- Send one controlled response and confirm the signed delivery returns `201`,
  creates one pending row, and returns `200 duplicate_submission` on replay.
- Confirm the captured payload uses the configured question keys and category
  option ID. This real delivery also validates signature compatibility with
  Tally's current serialization.
- Decide whether silently discarding a distinct response for an existing email
  is the intended lifecycle policy.
- Decide whether the initial submission audit record is required. The webhook
  treats audit logging as best effort, while the current production database
  does not contain `action_logs`.
- Run `pnpm test:tally`, `pnpm exec tsc --noEmit`, and `pnpm build` after the
  final environment/documentation changes.
- QA the embedded form on desktop and mobile: dark theme, dynamic height,
  keyboard use, required WhatsApp validation, successful completion, and the
  external-form link.
- Confirm Tally still has email duplicate protection enabled and WhatsApp is
  required. Never restore the 16 superseded responses from Trash.

The webhook parser and HMAC tests do not exercise a real Tally delivery or a
database transaction. Do not treat unit tests alone as end-to-end verification.
