# Historical Tally application migration

This document preserves the earlier migration and reconciliation record. Current intake uses the authenticated `/profile` application: `/join` redirects there, the Tally embed is removed, and both `POST /api/submissions` and `POST /api/tally/webhook` return `410 Gone` without creating local applications.

Existing `submissions` rows remain historical records. Their old approvals do not grant local membership. Eligible verified users can reuse historical answers in a profile, then submit the current application for local review. See [the local membership rollout](local-membership-rollout.md).

## Retired production verification (2026-09-18)

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

## Retired configuration and webhook

The historical integration used `TALLY_FORM_ID`, `TALLY_WEBHOOK_SECRET`, and `TALLY_FIELD_KEYS`, and verified signed deliveries before inserting `submissions`. Those settings no longer enable intake: the webhook returns 410 unconditionally. Do not resend old deliveries expecting new membership or application rows.

The old Tally form may still exist as an external historical source. Disabling its public intake/webhook is an operator action in Tally; removing the website embed does not delete its response data. Preserve the export and reconciliation material below before changing the external form.

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
5. The site no longer accepts Tally intake. If retiring the external form, disable
   its public intake/webhook without deleting responses, dropping
   `tally_submission_id`, or rewriting historical local rows.
6. Verify the synthetic release rows separately before removing them. Their
   removal must not change the original 43-row baseline or the 37 migrated
   source records.
