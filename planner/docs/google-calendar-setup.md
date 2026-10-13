# Google Calendar setup for DueNext

The integration is implemented but must remain disabled until its OAuth client
and consent configuration are ready. Basic Google sign-in is configured separately.

## Confirmed configuration

- Google Cloud project: `assignment-app-2fa6c` (project number `926317134302`).
- Calendar API (`calendar-json.googleapis.com`): enabled.
- Existing client: **DueNext**, a Web application in Google Auth Platform → Clients.
- Canonical app origin: `https://www.duenext.xyz`.
- Public support contact in DueNext: `arda.sarioglu@icloud.com`.
- Google consent-screen support: the project owner’s verified Google account, approved during setup.

## OAuth client and branding

Configure the existing DueNext client, preserving other valid callback URLs.

| Setting | Value |
| --- | --- |
| App name | DueNext |
| Homepage | https://www.duenext.xyz/ |
| Privacy policy | https://www.duenext.xyz/privacy |
| Support page | https://www.duenext.xyz/help |
| Authorized domain | duenext.xyz |
| JavaScript origin | https://www.duenext.xyz |
| Authorized redirect URI | https://www.duenext.xyz/api/google/return |
| Developer contact | arda.sarioglu@icloud.com |

Google's verified-account picker uses the owner's verified Google account,
explicitly approved during setup. The app's Help and Privacy pages use the requested
`arda.sarioglu@icloud.com` address. Both developer notification addresses are retained.

Declare only the scopes the existing implementation requests:

- `https://www.googleapis.com/auth/calendar.app.created`: create a DueNext secondary
  calendar and maintain events on that app-created calendar.
- `https://www.googleapis.com/auth/calendar.events.owned.readonly`: read events on calendars the user owns; the
  implementation imports only the user's primary calendar and never edits it.

Use an External audience for students using personal and school accounts. Follow
Google's verification process for the requested Calendar scopes. Testing access
requires the explicitly selected test users; Google sign-in alone does not grant
Calendar access.

## Production configuration

Store the existing client's ID as `GOOGLE_CLIENT_ID` and its secret as
`GOOGLE_CLIENT_SECRET` in the linked Vercel production project. Keep the secret
in a protected local file and pass it to the CLI through stdin. Never paste it
in chat, store it in a NEXT_PUBLIC variable, or commit it.

Set `GOOGLE_CALENDAR_ENABLED=true` only after the callback, consent settings, and
allowed audience are ready. Redeploy the current source with production settings.

## Verify with a consenting account

1. Open DueNext at its canonical address and sign in.
2. In Connections, choose Connect Google Calendar.
3. Confirm the Google screen names DueNext and asks for the two intended permissions.
4. Authorize, confirm the app reports Connected, and run a sync.
5. Confirm primary events are read-only and writes go only to the DueNext calendar.
6. Disconnect and confirm the saved connection is removed.

Before general release, complete any required domain, branding, and scope
verification. Do not tell students the integration is ready before a real
authorization and sync succeeds.

References: [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth),
[OAuth consent setup](https://developers.google.com/workspace/guides/configure-oauth-consent),
[App verification](https://support.google.com/cloud/answer/13463073).

## Setup status — 2026-10-13

The callback URL, app name/homepage/privacy branding, and the two narrowed scope
declarations are saved in Google Cloud. The existing DueNext client ID is saved
in Vercel production. The old client secret is masked and cannot be downloaded
from Google; no matching credential file was found locally. A new secret must be
created by the project owner and saved locally before it can be configured as a
Vercel Secret. Existing secrets must not be deleted as part of this setup.

Google requires a demo video and verification for event-reading access. Calendar
remains disabled for general users until its credentials and verification are ready.
The owner's OAuth consent and an actual import/export/disconnect test remain pending.

The source passed 361 unit checks, lint on the affected files, type checking, and
a production build. The OAuth callback is accepted by Google's authorization server.
Emulator integration checks could not run because the local Java runtime is missing;
the attempted official test-runtime download returned HTTP 403.
