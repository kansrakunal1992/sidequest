> **Newest handoff: `docs/HANDOFF_WAYPOINT.md`** (v12 checkpoint, includes a kickoff prompt for a fresh chat). This file is the older, longer reference.

# SideQuest: handover notes for a fresh session

(See also the paste-ready prompt the previous session gave the owner. This file is the same information kept with the code.)

## What this is
SideQuest: a free-forever social and dating app for adults 18+, Android first (Expo / React Native), iOS later. Backend: Supabase (Postgres + Auth + Storage + Realtime) with row level security, plus a Node API and worker on Railway. Brand reference: sparkle logo, midnight navy `#100D20`, purple `#713BF2`, tagline "People, plans, possibilities". Six vibes: Dating, Hookups, Friendship, Adventures, Post-Marital, Experiment. Core ideas: the invitation is the atomic unit, every consumer feature is free, safety is a foundation.

## Repository map
- `packages/shared`: pure TypeScript rules used everywhere (modes, contact rules, 18+ gate, invite state machine, ICS, rate limits, privacy rules, roulette grouping, activity categories, game banks, notification kinds). 35 tests.
- `supabase/migrations/0001..0013`: schema, RLS, functions. `supabase/tests/rls_smoke.sql`: the security smoke test to run on a real database. `scripts/check-sql.mjs`: static SQL safety checker (mutation-tested).
- `apps/api`: Railway API + worker (invites, calendar/ICS, push, JWT auth, jobs, chat media, webhooks, photo access). Dependency-light, testable with an in-memory store. 94 tests plus 7 integration tests that need a database (`test/pg-integration.test.ts`, run with `PG_TEST_URL`).
- `apps/mobile`: Expo app (expo-router). Pure logic in `src/core` (52 tests); screens in `app/`; stand-in type declarations live only in the sandbox (`node_modules/.sandbox`).
- `docs/`: PROGRESS.md (milestone table and next steps), API.md, DEPLOY_RAILWAY.md, ANDROID_RUN.md, SAFETY_LEDGER.md.

## Rules the design follows (keep them)
1. Every write for anything with rules goes through a checked database function; direct-write policies are removed and the SQL checker fails if one returns.
2. Clients can read only their own rows, plus what the discovery/profile/list functions return. Blocked, hidden, other-vibe and rejected all look like "unavailable" (no probing).
3. Column-level grants stop users editing protected columns.
4. Push text and notification copy never contain names, vibes or message text.
5. Free forever: likes, sparks, rewind, filters, visitors, incognito, read receipts toggle: no paywalls, caps or blurs.
6. Be honest in progress reports: separate "tests pass here" from "written but never run".

## Environment limits of the authoring sandbox
- Earlier sessions had no internet. In the v9 session the npm registry and apt were reachable, so Postgres 16 + PostGIS were installed and the SQL and `PgStore` were run for real (see docs/LOCAL_POSTGRES.md). Check what is reachable before assuming. Still not possible: running Expo/React Native, deploying, building an APK/AAB. The app is type-checked only against hand-written stand-ins; Node logic is tested with `node --test` (Node 22 strips types).
- The shell is plain `sh`: no brace expansion (`{a,b}`), no here-strings (`<<<`). Use Python heredocs for multi-file edits.
- `tsc` is global. Local symlinks (not in the zip) give packages their types: `apps/*/node_modules/@sidequest/shared`, `@types/node`, `@types/pg`, and `apps/mobile/node_modules/.sandbox/{stubs.d.ts,tsconfig.json}`. If you unzip fresh you will need to recreate these or run `pnpm install` where there is internet. In v9 the API ones were recreated by `npm install @types/node@22 @types/pg pg esbuild typescript` in a scratch folder and symlinking; the mobile stand-ins (`stubs.d.ts`) were NOT recreated (only `node --test` runs on mobile core, which needs none).

## Verification commands
```
cd packages/shared && node --test test/*.test.ts && npx tsc -p tsconfig.json
node scripts/check-sql.mjs
cd apps/api && node --test test/*.test.ts && npx tsc -p tsconfig.json
cd apps/mobile && node --test test/*.test.ts
```
Expected: shared 35, API 108 (+8 skipped without a database), mobile 107 (needs the real Expo packages and the render devDependencies, see docs/MOBILE_CHECKS.md; the 87 logic and contract tests need nothing), SQL checker clean. With a local Postgres also run `rls_smoke.sql` and `pg-integration.test.ts` (docs/LOCAL_POSTGRES.md).

## Next steps
See "NEXT STEPS" in docs/PROGRESS.md: admin page, then the app screens (Circles tab, teams, circle detail, roulette and double-date creation, safety hub, notification inbox, game screen, restricted-account screen), then milestone 9.

## Owner requests to honour
- At 100%, a dedicated design discussion on keeping the community high quality: people who want quality get quality, bad actors are kept from ruining it. The working principle in docs/SAFETY_LEDGER.md: sort by consent (explicit vibes and agreed-to-see), remove by conduct (do not route abusers to each other). Present trade-offs honestly, including false-positive risk, moderation cost, appeals, and what technology cannot solve.
- Always attach the updated full zip at the end of every step, versioned (-v9, -v10, ...), and report progress out of 100.
