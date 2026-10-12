# DueNext for International Academy

Private assignments, A/B class timetables, Canvas imports, and optional Google Calendar sync. This is a student CAS project; the release target is a small pilot followed by at most 400 registered students.

## Run locally

Use Node 22.13 or newer and `npm ci`. Configure server credentials in `.env.local` using the names in `.env.example`, then run `npm run dev` and open http://localhost:3000.

Google sign-in and Google Calendar are separate configurations:

- Enable Google as a Firebase Authentication provider and authorize `localhost` plus the production hostname. Students choose their own Google accounts. Sessions expire when the browser session ends unless Remember me is selected.
- The secure storage backend requires `FIREBASE_ADMIN_CREDENTIALS` (Firebase service-account JSON) or local `GOOGLE_APPLICATION_CREDENTIALS`. Never paste credentials into chat, commit them, or prefix them with `NEXT_PUBLIC_`. Use a service identity scoped to the intended Firebase project, with Firestore access and the Firebase Authentication permissions needed for verification, revocation, and account deletion.
- `TOKEN_KEY` must contain 32 random bytes encoded as base64. Preserve the existing key for legacy credential migration and encrypted backups.
- Set `APP_ORIGIN` to the exact app origin, including the port locally. Production requires HTTPS and an explicit origin.
- Set `SCHOOL_CALENDAR_ADMIN_UID` to your verified Firebase UID. Calendar management does not grant access to student planners. There is no first-user administrator shortcut.
- Configure the app-owned `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, authorize `<APP_ORIGIN>/api/google/return`, and complete the required consent/verification process. Set `GOOGLE_CALENDAR_ENABLED=true` only when ready. Manual tracking and Canvas remain independent of Google Calendar.

The school calendar contains 334 explicit dates from August 2026 through June 2027 and 180 student school days. The source PDF and its SHA-256 are retained. Blue means B and white means A. No rotation is guessed. Early-release days show dismissal at 11 a.m.; unpublished special class times are not fabricated.

Connect Canvas, complete a course sync, then open **My A/B timetable → Choose a Canvas class**. The picker includes only the current student's active Canvas courses. Choose A/B, room, and times yourself. Reopening the timetable refreshes choices. Replacing/disconnecting Canvas hides the previous account's course choices. Classes without Canvas can be entered manually.

## Data and API boundaries

All database access goes through authenticated server routes; `firestore.rules` denies every direct browser read and write. The Admin SDK bypasses those rules, so every route also enforces its own verified-UID ownership. Deploying the rules is a release requirement, not implied by committing them.

Tasks and classes are individual owner-scoped documents. Task POST requires `Idempotency-Key`; PATCH/DELETE require the displayed `revision`, returning 409 for stale edits. GET tasks uses `limit` (1–300) and an opaque document-ID `cursor`. Undated tasks use `date:null`; events require dates. Provider imports are idempotent and sync resumes from private per-provider jobs. No credential is returned by task, connection, course, or export APIs.

API routes: `/api/tasks`, `/api/timetable`, `/api/courses`, `/api/school-calendar`, `/api/connections`, `/api/sync`, `/api/google/start`, `/api/google/return`, `/api/account`, `/api/oauth-session`, and restricted legacy recovery routes. Sync returns provider status/count/error; `pending` requires another POST, `busy` means another worker owns the lease, and `error` can be resumed. Completion timestamps only advance after a complete provider pass. Source outages never authorize removal of an incomplete provider snapshot.

Google primary events are read-only. Writes are limited to the app-created DueNext calendar and use event revision checks. A disconnect/deletion blocks pending writes at the provider mutation boundary; an already-sent provider request can complete. Sync runs while the app is open, not as a background reminder service. Timetable blocks stay in DueNext.

## Verification

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npm run test:cyd`.
- `npm run emulators:integration` starts disposable Auth/Firestore services on 9199/8180 for integration tests. Install Java 21 or newer first. These use `demo-duenext-integration` and do not erase the interactive demo on 9099/8080.
- `npm run emulators` starts the interactive demo on 9099/8080. To run its UI independently, set `DUENEXT_BUILD_DIR=.next-test`, `FIREBASE_PROJECT_ID=demo-duenext`, both server emulator hosts, `NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-duenext`, a dummy public API key, `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099`, and `APP_ORIGIN=http://localhost:3100`, then run `npm run dev -- --port 3100`. Test sign-in is the emulator widget, not a real Google login. Never set emulator variables in production.
- Against the interactive demo, run `FIREBASE_PROJECT_ID=demo-duenext FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run test:load`. It creates 400 synthetic accounts with 50 assignments each and requests 100 planners concurrently. The script rejects a remote/non-demo target.
- `scripts/calendar-source.py` reproduces the seed from PDF cell geometry, colors, and annotations using pdfplumber. Unit tests independently check every date against visually reviewed month lists. This is an operator tool; publishing a new PDF requires review rather than unattended scraping.

See [release and recovery procedures](docs/release.md) before sharing with students.
