# SideQuest build progress

**Overall: 84 / 100**   (drop: sidequest-v10.zip. Steps 2 and 3 of the v8 plan are done: moderation page, all Circles / safety / inbox / game / restricted-account screens. Milestone 9 (release prep) and the quality discussion are still to do. Nothing has run on a phone or against a hosted Supabase project; see Verification honesty.)

| # | Milestone | Weight | Done | Status |
|---|-----------|-------:|-----:|--------|
| 1 | Foundation: monorepo, design tokens, tested shared logic | 10 | 10 | Done. 25 tests |
| 2 | Database: schema, RLS, RPCs, hardening, tests | 15 | 14 | 60 tables, 13 migrations. All 13 apply on Postgres 16 and `rls_smoke.sql` passes (205 checks), but against **stand-ins** for Supabase's own schemas, **not a hosted Supabase project** |
| 3 | API on Railway: invites, calendar/ICS, push, JWT auth, jobs, calls, photo moderation, deploy | 15 | 15 | 108 tests pass plus 8 integration tests that run `PgStore` and the worker jobs on a real local Postgres; bundles build; worker and server boot. Never run against a hosted Supabase project |
| 4 | Android app shell: design system, auth, onboarding, mode picker | 15 | 11 | Logic tested. UI now type-checks against the REAL Expo SDK 54 / React Native 0.81 types (one error found and fixed), **never run on a device**. Needs your first device run |
| 5 | Discovery, likes, visitors, matches, profiles | 10 | 8 | Built. DB functions and UI never run; API photo access and app logic tested. See below |
| 6 | Chat, Conversation Invites UI, Calendar, Open Calls, Activities | 15 | 14 | Built: chat, invitations, calendar, push, Open Calls, Activities, group chat. Not built: in-app calling client, chat voice notes. All new SQL and screens unrun |
| 7 | Circles, Wingperson, Double Dates, Roulette, Chemistry games, Date Planner, Together | 10 | 8 | Circles tab (Circles / Social Roulette / Double dates), circle detail and creation with plans, teams, roulette and double-date creation, wingperson (invite, accept, suggest, review suggestions), Together (both partners consent, per-side sharing), game screen and Play button in chats. Logic tested; each screen rendered in jsdom against fake data. **Never on a device.** Gaps: no way to invite someone into a private circle (so private circles are refused in the app); no dedicated Date Planner screen beyond invitations and the calendar; the wingperson sees only profile wording, not a richer owner view |
| 8 | Safety and admin: report/block UI, moderation console, delete/export, notification inbox | 5 | 4 | `/admin` page (queue, report context with audit trail, appeals, photo review) with a real-DOM test against hostile content; safety hub (friend code, trusted contacts and check-ins, wingperson, Together, privacy and pause, export and deletion, blocked list), notification inbox, restricted-account screen with appeal and cancel-deletion. Worker jobs done. **The admin page has not talked to a hosted Supabase; nothing has run on a device** |
| 9 | Release: e2e tests, Play readiness, signed AAB guide | 5 | 0 | |

## How to verify what exists
```
cd packages/shared && node --test test/*.test.ts && npx tsc -p tsconfig.json     # 35 tests
node scripts/check-sql.mjs                                                         # static SQL checks
cd apps/api    && node --test test/*.test.ts && npx tsc -p tsconfig.json           # 108 pass, 8 skipped without a database
cd apps/mobile && node --test test/*.test.ts && npx tsc -p tsconfig.json          # 107 tests (needs the real Expo packages installed, see docs/MOBILE_CHECKS.md)
# with a local Postgres (docs/LOCAL_POSTGRES.md): migrations 0001-0013, rls_smoke.sql, and
cd apps/api && PG_TEST_URL=postgres://... node --test test/pg-integration.test.ts  # 8 integration tests
# Supabase SQL editor: migrations 0001-0013, then supabase/tests/rls_smoke.sql
# Phone: docs/ANDROID_RUN.md
```

## Verification honesty
- Run and passing in the authoring sandbox: shared (35), API (108, plus 8 integration tests against a real local Postgres 16), mobile (107: core logic, a contract test, and 20 screen renders); typechecks of all three packages; SQL static checker (mutation-tested); API bundles build and boot; the worker runs all its jobs against the real database without error.
- Run on real Postgres 16 (PostGIS, and **stand-ins** for Supabase's `auth`, `storage`, roles and default grants): migrations 0001-0013 and `rls_smoke.sql`. **Not run on a hosted Supabase project.** The stand-ins are in `supabase/tests/local_stubs.sql`, written from memory of Supabase.
- **Mobile is now type-checked against the real Expo SDK 54 / React Native 0.81 type packages**, not hand-written stand-ins (docs/MOBILE_CHECKS.md). That found one real error in an older screen. The new screens were also **rendered**: the real screen code is bundled with react-native-web and mounted in jsdom, with only Supabase, expo-router, session, icons and the gradient replaced by fakes. That proves screens load, validate, call the right database functions with the right argument names, and navigate. It does NOT prove native look, gestures, keyboard handling, fonts, or that Expo and Supabase behave on a phone. The older (milestone 4-6) screens were type-checked against real types but not rendered.
- A contract test (`apps/mobile/test/db-contract.test.ts`) reads every database call in the app and checks the function exists, every argument name matches the migration SQL, every required argument is passed, and signed-in users may execute it. It also covers the older screens' direct `rpc` calls, and they pass.
- Bugs only real execution found (all fixed): a CASE-inside-IF syntax error in 0009 (`wing_suggest`), a text-to-enum type error in 0008 (`express_interest`), `PgStore.ensureConversation` passing the wrong parameter number; in 0009 the invited partner of a couple could never accept and nobody could change sharing (fixed in 0013); no way to review pending photos or see report context (0012).
- Written, not executed anywhere: `SupabaseAdminClient` against real Supabase Storage/Auth (tested against a fake server whose request shapes follow the supabase-js source), the Supabase client calls in the app against real Supabase, webhook delivery, FCM push, the `/admin` page's sign-in against Supabase's real email-code flow.
- Not possible here: running Expo on a device/emulator, deploying, building an APK/AAB.

## Milestone 5 notes
- Discovery only lists people who share your vibe, satisfy both sets of preferences, are not blocked, have an **approved** photo visible in that vibe, and are not paused or hidden. Ranking uses shared interests, availability and distance; reasons are shown in plain language, never as a score.
- Likes, sparks, rewind, filters, Likes & Matches and Visitors are free and unlimited. A visit and a like are listed separately; incognito visits are never listed; pausing a vibe hides you from that vibe's lists without deleting anything.
- Rewind works for passes and for likes that have not become matches.
- Other people's photos are signed by the API under the same visibility rules as profiles (tested). Your own photos are signed on the device.
- Block and report are on every profile. Blocking is silent.
- Not yet: save-for-later collections UI, "reconnect with previous matches", profile prompts shown as separate interactions beyond tap tracking.

## Milestone 6 (part 1) notes
- Chat: live messages, unread badge, read receipts (optional), conversation starters from shared interests (suggestions only, never auto-sent), images hidden until the recipient taps to view, block/report in the chat menu.
- Anti-harassment guards are in the database: 3 messages until a reply, 30 a minute. A reply lifts the limit.
- Invitations: compose (format, time, duration, note), list with "Needs your reply", detail with exactly the actions the shared state machine allows (tested against it for every state and role). "Too new to say hi" opens nothing automatically; only the recipient can later say hello.
- Calendar tab shows confirmed, cancelled and past plans; "Add to my calendar" opens the phone's calendar app (no permission).
- Private post-meeting questions after an invitation is marked done.
- Honest gaps: in-app voice/video needs the LiveKit client SDK (native module) and is not built, so the app shows no Join button; voice notes in chat not built; reminders and message pushes need Firebase and a webhook (see docs).

## NEXT STEPS (checkpoint v10): do these in order
1. Milestone 9: release prep. End-to-end checks (real server bundle plus worker against a real Postgres through HTTP), Google Play readiness notes (check the current Play policy pages for dating apps, Data safety form, target API level, closed-testing requirement for new developer accounts), a signed AAB guide, and a store listing text pass. Research current Play requirements before writing them.
2. First device run (yours): follow docs/ANDROID_RUN.md, then send me every error text. Expect small fixes: the screens have only been rendered in jsdom.
3. At 100%: the quality-and-safety design discussion (see docs/SAFETY_LEDGER.md, including "Known gaps").
4. Backlog found while building: a way to invite people into private circles; a place picker to replace free-text roulette areas; raise the app's `safety` Android notification channel to high importance (apps/mobile/src/lib/push.ts); consider an SMS/email path for trusted contacts who do not use the app.

## Milestone 6 (part 2) notes
- Open Calls: create (with idea templates), browse / hosting / joined, Interested or Pass, host accepts or declines, capacity and waitlist, group chat for accepted people, edit, cancel, mark done. Calendar entries for host and guests.
- Activities: 13 categories, public listings, join with a waitlist and automatic promotion, attendee list for people who are going, host cancel. A friendly invitation is offered between attendees who are both in Adventures.
- Every write goes through a checked function; the old direct-write policies were removed (the SQL checker now fails if one comes back).
- Group chat: names above messages, long-press to report a message, no first-contact limit, messages from blocked people hidden.
- Not built: post-meeting questions for groups, host-side per-person feedback, recurring Open Calls, in-app voice/video client, voice notes.

## Security model
- Clients read only their own rows. Other people's profiles come only through `discover_people()` and `view_profile()`.
- Column-level privileges (0005): users cannot change their own account state, date of birth, onboarding flag, photo approval, conversation membership, or a wingperson's permissions. Profiles are created only by `save_onboarding()`, which snaps location to ~1 km and enforces 18+ in the database.
- Invites, calendar entries, notifications and matches cannot be written by clients.
- API: JWT verification (HS256 or ES256/RS256 via JWKS), per-IP and per-user limits, 32 KB bodies, outsiders and blocked users get identical 404s.
- Photos fail closed: pending until a provider or human approves; EXIF/location is stripped on-device before upload.
- Session tokens are stored in the Android Keystore-backed SecureStore; no broad storage, background-location or exact-location permissions are requested.
- Push text never contains names, modes or intent.

## Known gaps (planned)
- Discovery UI, Likes & Visitors UI, signed photo URLs for other people's photos (M5).
- Chat UI, invite UI, calendar UI, Open Calls and Activities (M6).
- Couples and double-date discovery RPCs; Circles, Wingperson UI, Roulette UI (M7).
- Account deletion/export, moderation console, report/block UI, privacy screens (M8).
- No real age-verification or image-moderation provider is plugged in yet (interfaces and fail-closed behaviour exist).
- Rate limiter is in memory; move to Redis before running several API replicas.
- Terms and Privacy Policy are not written yet; anything shown is a placeholder pending legal review.

## Decisions
- Name: SideQuest. Bottom tabs: Discover, Circles, Chat, Calendar, Profile. Discover top tabs: People, Open Calls, Activities.
- Email one-time-code sign-in (no passwords). Rewind and Spark are free and unlimited.
