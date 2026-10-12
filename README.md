# DueNext — Student Dashboard

A student planner for International Academy, combining assignments, personal plans,
college deadlines, A/B class timetables, and the official school calendar.
Includes optional Canvas imports, Google Calendar sync, and an ESP32 USB display.

[Open DueNext](https://assignment-app-nine.vercel.app/)

## What's included

- [`planner/`](planner/README.md): Next.js dashboard, Firebase-backed private
  student storage, API routes, UI components, tests, calendar data, and source PDF.
- [`cyd/`](cyd/README.md): ESP32-2432S028R display firmware and USB diagnostic helpers.
- [`planner/docs/release.md`](planner/docs/release.md): release, migration, and
  recovery procedures for operators.

## Run the dashboard

Requires Node.js 22.13 or newer and your own Firebase project.

```sh
cd planner
npm ci
cp .env.example .env.local
# Fill in your Firebase configuration and server credentials in .env.local.
npm run dev
```

Open http://localhost:3000. Enable Google sign-in in your Firebase project,
configure the server service account and encryption key, and deploy the Firestore
rules before using real accounts. Detailed setup and local emulator instructions
are in the [dashboard README](planner/README.md). Google Calendar is optional.

## Verify

From `planner/`:

```sh
npm run typecheck
npm run lint
npm test
npm run test:cyd
npm run build
```

Integration tests use disposable local Firebase emulators and require Java 21
or newer: `npm run emulators:integration`.

## Display firmware

See the [CYD guide](cyd/README.md) for hardware, compilation, and pairing.
The dashboard works without a physical display.

## Public source

This repository contains a snapshot of the current source, with demo Firebase
defaults. Each installation needs its own configuration. Credentials, student
records, device backups, deployment caches, dependencies, and local development
history are excluded. The existing hosted app is configured separately.

The bundled UI components retain their
[shadcn license notice](planner/sources/shadcn-LICENSE.md).
