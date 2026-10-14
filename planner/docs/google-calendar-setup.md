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

## Setup status — 2026-10-14

The callback, branding, and two narrowed scope declarations are saved in Google
Cloud. The client ID and server-only client secret are configured in Vercel.
Calendar is enabled in production. The production build passed and the live OAuth
callback responds with the configured handler. Google accepted the client credentials
in a token-endpoint validation (an intentionally invalid code returned invalid_grant).

Google branding and sensitive scope verification remain pending. The owner's
OAuth consent and a real import/export/disconnect test also remain pending;
enabling the connection does not establish that end-to-end sync has succeeded.

The source previously passed 361 unit checks, focused lint, type checking, and a
production build. Emulator checks could not run because Java is missing and the
official test-runtime download returned HTTP 403.
