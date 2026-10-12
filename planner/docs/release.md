# Release and recovery procedures

This public source snapshot includes the web dashboard and CYD display firmware.
Configure your own Firebase project and deployment; the public copy uses demo
Firebase defaults and contains no live credentials, student records, or backups.

## Verification

From `planner/`, run `npm run typecheck`, `npm run lint`, `npm test`,
`npm run test:cyd`, and `npm run build`. Integration tests require Java 21 or newer:
`npm run emulators:integration` starts disposable Auth/Firestore emulators.
Use the load-test command in the app README only against local demo emulators.

## Before sharing an installation with students

1. Configure your own Firebase Google sign-in provider, authorized domains, server
   service account, encryption key, exact app origin, and explicit calendar admin UID.
2. Deploy `firestore.rules` to your project. Verify API isolation with two accounts
   and confirm that direct browser database access is denied.
3. Enable Google Calendar only after configuring and verifying OAuth consent,
   redirect URI, support contact, and privacy disclosures.
4. Check Canvas access with school IT and test actual course imports. This source
   is configured for International Academy's `ia.instructure.com` instance.
5. Verify keyboard navigation, school devices, mobile layout, login/logout and
   account switching, task edits/completion, provider reconnect, export, deletion,
   and optional display clearing.
6. Measure capacity, costs, and provider limits in a small pilot before expanding.
   Local synthetic load results do not certify production capacity.
7. Keep service-account files, environment files, student exports, migration
   backups, and device flash backups outside version control.

## Cloud migration

`npm run migrate -- --uid=<original-uid>` is read-only by default. Supply credentials and the original TOKEN_KEY through the environment. For local env files, use Node's `--env-file` options with the scripted `--conditions=react-server --import tsx` invocation. `--apply` writes encrypted `.sealed` backups under ignored `migration-backups/` with restrictive filesystem permissions, creates missing owner-scoped task documents, moves encrypted connections, deletes plaintext legacy fields, and records migration version 3. Existing new-format tasks are not overwritten.

Migration includes missing parent user documents, legacy `settings/duenext` credentials, and assignments in `workspaces/<verified Firebase UID>`. Workspaces without a matching Firebase identity are left inaccessible for operator review and are never assigned to another account. Canvas IDs are normalized to the current provider identity so a subsequent sync preserves completion status. Legacy classes without A/B times remain private and appear as `legacyClasses` in the account export. Owner-scoped legacy workspace documents are removed only after replacement records and encrypted backups exist.

Set `LEGACY_PERSONAL_OWNER_UID` before migrating any known auto-seeded personal-assignment IDs. Those IDs are retained for the original owner and excluded for other accounts. Unknown/invalid/duplicate legacy records stop migration for operator review; original bytes remain in an encrypted backup. A failed migration leaves `migrating:true`, intentionally blocking the app's writes. Correct the cause and rerun the same UID to resume. The CLI requires a server-side Firebase identity; it does not run with a student's ID token.

Before applying, verify access to the backup folder and ensure sufficient space. Test decryption with the retained TOKEN_KEY and compare task IDs/counts. Backups may contain sensitive historical data and tokens even though encrypted; retain them offline with restricted access only for the cutover, then remove them after the 30-day recovery window. Keep the decryption key in the operator's secret store, separate from the backups.

For recovery, decrypt a chosen backup in an operator-controlled environment, validate the snapshot, and rerun the new-format migration/recovery code for that same verified owner. Do not restore plaintext tokens or permissive legacy rules. Never restore a whole database over newer students' work. Reconcile owner/task IDs and revisions against the current data before restoring missing records. Account deletions must be reapplied before a restored snapshot is exposed.

## Legacy browser records

Loading the updated client removes the origin-wide plaintext Canvas credential key. After authentication, legacy task records are sent only to an encryption endpoint, returned as ciphertext, and replaced locally by a quarantine blob. They are not automatically imported under the current student. Failed encryption preserves the original records and prevents opening the planner until the upgrade can be completed.

Only the configured `LEGACY_PERSONAL_OWNER_UID` can explicitly import a reviewed quarantine from their original browser. Recovery treats records as manual items, preserves existing cloud IDs, and never imports browser credentials. An original owner must reconnect Canvas rather than reuse an unowned token. Do not lend the browser before the upgrade finishes.

## Monitoring and rollback

Record HTTP status, latency, sync completion/failure counts, and provider quota responses. Do not log headers, tokens, OAuth codes, assignment contents, or exported planner data. Review 401/403, 409, 429 and 5xx trends during the pilot. Suggested operational thresholds: planner API p95 above 2 seconds for 10 minutes; 5xx above 1% for 10 minutes; or provider errors above 5% of syncs. Owner-facing notifications require an explicit notification channel configuration; none was created automatically.

Set budget notifications in both Firebase/Google Cloud and Vercel before broader release. Check actual usage with the pilot to decide whether the five-minute foreground sync interval is affordable. Per-provider credential fingerprints let Canvas and Google resume independently, and interrupted Google writes preserve newer local edits. Manual Sync now bypasses the normal five-minute cache while respecting start limits. Provider snapshots are bounded to 200 active Canvas courses and 15,000 tracked imported IDs; exceeding limits retains existing records and reports an error. API caps include 60 writes/minute, 120 reads/minute, 120 sync continuation requests/minute, two new provider syncs/minute, ten connection/OAuth changes per ten minutes, and five exports/recovery operations per hour per student.

Use a tested new-format deployment for rollback. Avoid the original browser fallback and legacy plaintext storage implementation. Preserve database migrations and encryption keys; rollback must not discard newer records. Freeze affected writes, inspect encrypted backups, repair the invariant, and re-test two-account access before resuming.

Account deletion retains only a minimal tombstone to prevent stale workers from resurrecting data. If provider revocation or cleanup fails, resume deletion with a fresh sign-in or finish the tombstoned account through an operator script before enabling it again. Reapply deleted-account tombstones whenever restoring a service backup. Service-level backup retention and restoration procedures must be configured and recorded before the school launch; this repository does not silently enable a paid backup product.

