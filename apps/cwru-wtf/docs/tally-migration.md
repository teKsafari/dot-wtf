# Tally application migration runbook

The published application form is `https://tally.so/r/lbp7OX`. It is embedded
on `cwru.wtf`, while the previous local submission endpoint returns `410`.
Tally collects applications and `POST /api/tally/webhook` copies new responses
into the local `submissions` table used by the admin dashboard.

## Production verification

The production embed and webhook were verified on 2026-09-18.

- The embed works at desktop and 390 px mobile widths. Inputs fit, dynamic
  height works, and the external-form link opens correctly.
- Nunito is computed inside the form. The Klariti logo is configured in Tally;
  the site does not add a second logo around the embed.
- Preview and production have the exact form ID, field-key map, and signing
  secret. Do not set these values with a command that appends a newline; a
  newline changes the HMAC secret and causes `401` responses.
- Signed Tally responses `2jZ0Gbj` and `Ar0ZEyo` created local rows 89 and 90 as
  active pending applications.
- Tally dashboard event `448ae1aa-803d-41c4-ab19-099ff8aa256b` was resent at
  16:45Z and received HTTP `200`.
- Two controlled signed replays returned `200 duplicate_submission`; each
  Tally response has only one local database row.
- The admin dashboard opened on Pending and displayed both verification rows
  after refresh.

Synthetic rows 89 and 90 were removed after verification, and their Tally
responses were moved to recoverable Trash. The final counts are 37 live Tally
responses and 43 local rows (37 active, 6 archived). A fresh comparison confirms
all 37 historical active records still match the source export exactly.

## Historical migration

The migration copied every row where `archived_at IS NULL` into Tally while the
webhook and notifications were disabled. The original database rows were not
rewritten.

- The baseline database contains 43 original rows: 37 active and 6 archived.
- Tally received the 37 active applications: 36 approved and 1 waitlisted.
- The 6 archived applications were intentionally excluded.
- Production migration `0007_parched_nico_minoru.sql` adds only nullable
  `tally_submission_id` and its unique constraint.
- The canonical source record-set SHA-256 is
  `b48f3b0ecb138ae71083f8cd57b47b34bc66bb6ef26458d69a2b1d72c5ecb4cd`.
- Final reconciliation found 37 distinct Tally response IDs and exact source
  values. Category order and phone formatting were compared semantically;
  original values remain lossless in `legacy_record_json`.

Tally's `Submitted at` is the time Tally received a recreated response on
2026-09-18. The historical timestamps and review state are preserved in these
hidden fields:

| Hidden field | Preserved value |
| --- | --- |
| `legacy_submission_id` | Original local submission ID |
| `legacy_created_at` | Original PostgreSQL creation timestamp text |
| `legacy_updated_at` | Original PostgreSQL update timestamp text |
| `legacy_review_status` | `pending`, `approved`, or `waitlist` |
| `legacy_interests` | Optional legacy interests; null may be blank or `null` |
| `migration_source` | `cwru-wtf-legacy-2026-09-18` |
| `legacy_record_json` | Complete exported source record |

Sixteen superseded migration responses with incorrect phone entry are in
Tally's recoverable Trash. Their corrected replacements are in the live
37-response set. Never restore the superseded copies.

Missing legacy phones and two unusable historical phone strings are blank in
the normal phone question. Their exact originals remain in `legacy_record_json`.

## Runtime configuration

Set these values in every deployed environment:

- `TALLY_FORM_ID=lbp7OX`
- `TALLY_WEBHOOK_SECRET`: the exact secret configured on the Tally webhook
- `TALLY_FIELD_KEYS`: the one-line JSON below

```json
{
  "name": "question_QBV8a7",
  "email": "question_9JQ2gQ",
  "whatsapp": "question_exR9je",
  "categories": "question_WpzlkN",
  "otherCategory": "question_ardZPB",
  "wtfIdea": "question_6QNrzk",
  "currentProject": "question_79x4gZ",
  "youtubeLink": "question_b4dNEL",
  "otherCategoryOptionId": "784fb875-8f79-40a3-acf7-286060fc241b"
}
```

The eight question keys come from `data.fields[].key`; the Other option ID
comes from the categories field's `options[].id`. Labels are display text. If a
Tally question is recreated, update its machine key before publishing.

The form ID is also hard-coded in `components/tally-application-form.tsx` and
`app/api/submissions/route.ts`. Update all three locations if the form changes.
The dark theme, Nunito, Klariti mark, duplicate protection, and required-phone
setting live inside Tally because host CSS cannot style a cross-origin iframe.

## Webhook behavior

The route verifies `Tally-Signature`, enforces a 1 MB limit, checks the form,
and revalidates every application field. `eventType` may be absent on Tally
dashboard test or resend deliveries. When present, it must be `FORM_RESPONSE`.

A new response becomes active and pending. The Tally submission ID makes
automatic and manual replays idempotent. A different response using an email
already present locally returns `200 duplicate_email` and does not create or
change a local row, including for archived, approved, or waitlisted records.
That existing-email policy is retained for this release.

Submission audit logging is best effort. The pre-existing production database
does not contain `action_logs`; a missing audit table does not fail application
capture. This is an accepted release behavior rather than an open gate.

## Private export and reconciliation

Create a read-only active-record export outside the repository:

```sh
pnpm tally:export \
  --output-dir /secure/private/cwru-tally-export-2026-09-18
```

The exporter selects only `archived_at IS NULL`, never writes to the database,
refuses to overwrite files, and creates its JSON, CSV, and manifest with mode
`0600`. The files contain applicant data. Keep the export, reconciliation
audit, and original-ID-to-Tally-ID journal private and delete them only after
the rollback window.

## Restore and rollback

Protect response data before any restore or rollback:

1. Export current Tally responses and take a read-only database snapshot.
2. Look up the final Tally response ID in the private migration journal. Restore
   only an ID confirmed by that journal; never bulk-restore Tally Trash.
3. Do not restore the 16 superseded phone-entry responses. Do not copy the 6
   locally archived applications into Tally unless that scope is approved.
4. Treat local database rows as the historical source of truth. Do not replace
   original timestamps or decisions with Tally's received time.
5. To pause intake, disable the Tally webhook or public form without deleting
   Tally responses, dropping `tally_submission_id`, or rewriting local rows.
6. Verify the synthetic release rows separately before removing them. Their
   removal must not change the original 43-row baseline or the 37 migrated
   source records.
