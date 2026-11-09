# Waypoint (formerly SideQuest): handoff for a fresh chat

Written 7 November 2026 at checkpoint **`sidequest-v12.zip`** (a work-in-progress checkpoint, see section 3).
**How to use:** open a new chat, attach `sidequest-v12.zip` and this file, then paste the **kickoff prompt in section 11**.
Everything in this file was true when it was written. Where something is unverified it says so.

---

## 1. The project in one paragraph

A free-forever social and dating app for adults 18+ (**Android first** with Expo / React Native, iOS later). Backend: **Supabase** (Postgres, auth, storage) plus a **Node API and worker on Railway**. The owner is a non-developer. **The owner has deployed the app end to end** (self-reported: "it looks nice") and now wants five changes (section 4). The owner is new to all of this, so explanations must be plain and step by step.

## 2. How the owner wants me to work (keep these)

* **I write and test the code myself**, end to end, across as many turns as needed.
* **Report progress as a percentage out of 100 every turn.** Be **strictly honest**: separate "tests pass here" from "written but never run". Never inflate. Current number: **84** (unchanged by this checkpoint; the new work is not integrated into the app yet).
* **Attach the updated full zip at the end of every step**, with an incrementing name (`sidequest-v13.zip`, ...). Verify the zip from a fresh unzip before presenting it.
* **Keep replies short:** lead with what changed, then what is verified, then what is not.
* The shell is **plain `sh`**: no `{a,b}` brace expansion, no `<<<` here-strings. Use Python heredocs for multi-file edits.
* **Design rules that must never be broken:**
  1. Every write for anything with rules goes through a **checked database function**. Direct-write policies are removed. `scripts/check-sql.mjs` fails if one returns.
  2. **Blocked, hidden and rejected all look like "unavailable"** (same error, same wording).
  3. **Column-level grants** protect sensitive columns.
  4. **Push text never contains names, vibes or message text.**
  5. **Every consumer feature stays free** (no paywalls, caps or blurring of likes and visitors).
  6. **Wingpersons can never access chats.**
  7. Safety must be **explicit to the user**: warn openly, never filter silently.
* At 100%, hold a **design discussion on community quality**. Working principle from `docs/SAFETY_LEDGER.md`: **"sort by consent, remove by conduct."** Present honest trade-offs: false positives, moderation cost, appeals, and what technology cannot solve.

## 3. Current state of the checkpoint (exact numbers)

Run from a fresh unzip: `corepack enable && pnpm install && pnpm test && pnpm typecheck && pnpm check:sql` (this path was tested from a fresh unzip with pnpm 9.15, Node 22).

| Check | Result in this checkpoint |
|---|---|
| `packages/shared` tests | **49 pass**, typecheck clean |
| `apps/api` tests | **116 pass, 8 skipped** (the 8 need a database), typecheck clean |
| `apps/api` integration against real Postgres 16 | **8 pass** |
| `apps/mobile` tests (logic + contract + 20+ screen renders) | **110 pass**, typecheck clean against the REAL Expo SDK 54 / React Native 0.81 types |
| `supabase/tests/rls_smoke.sql` on real Postgres 16 | **passes, 235 checks**, migrations 0001 to **0015** apply |
| `scripts/check-sql.mjs` | passes |

**What is verified vs not.** Verified in a sandbox: all of the above, plus the generated Android project (`expo prebuild`) targets API 36 with package `app.sidequest.android`. **Not verified anywhere by me:** anything on a real phone, on a hosted Supabase project, on Railway, Firebase, Expo cloud builds or Google Play. The Supabase pieces in the sandbox were **stand-ins** (`supabase/tests/local_stubs.sql`, written from memory). The owner's own deployment is the first real-world evidence, but they have not yet reported details beyond "it looks nice" and the three problems below.

**Why this is a "work-in-progress" checkpoint:** the database and shared-code parts of requests 4 and 5 are done and tested; the **API, admin page and app screens for them are not written yet**, and requests 1, 2 and 3 are diagnosed but not coded. Nothing is broken: every suite above is green.

### Files added or changed since `sidequest-v11.zip`

NEW:
* `packages/shared/src/mode-theme.ts`: a full look per vibe (`MODE_THEMES`, `NEUTRAL_THEME`, `themeFor`, `contrastRatio`, `onAccentFor`).
* `packages/shared/src/mode-features.ts`: which features each vibe has (`MODE_FEATURES`, `modeHas`, `FEATURE_LABEL`, `modeFeatureList`, `DB_ENFORCED_FEATURES`).
* `packages/shared/src/trust.ts`: scam, explicit-content and account-trust logic (`assessMessageText`, `describeAccountTrust`, `accountLooksSuspicious`).
* `packages/shared/test/mode-theme-features.test.ts`, `packages/shared/test/trust.test.ts`.
* `supabase/migrations/0014_mode_features.sql`, `supabase/migrations/0015_trust.sql`.
* `docs/START_TO_FINISH_GUIDE.md`: the beginner guide from zip to Google Play (**still says SideQuest everywhere and describes the old location/notification setup**; update after the rebrand).
* `scripts/sandbox/` (helper scripts, see its README).

EDITED:
* `packages/shared/src/tokens.ts`: the default button gradient was darkened (`#4458E8` to `#7C3AED`) because **white text on the old `#4F6BFF` failed the 4.5:1 readability standard**.
* `packages/shared/src/notifications.ts`: new kind `verification_result`. `apps/api/src/notifications.ts` (push copy) and `apps/mobile/src/core/inbox-core.ts` (inbox wording) cover it (both are exhaustive `Record`s, so the compiler enforces coverage).
* `apps/mobile/app.json`: `expo-build-properties` (target SDK 36), `RECORD_AUDIO` blocked, `microphonePermission: false`; `apps/mobile/package.json`: dependencies pinned to the verified SDK 54 versions, `expo-system-ui` added; root `package.json`: `pnpm test` now runs packages one at a time (parallel runs made slow computers flake).
* `apps/mobile/test/render/harness.ts`: clicks now wait for the app to react (fixes flakiness).
* `supabase/tests/rls_smoke.sql`: new sections for 0014 and 0015; older sections run with a widened feature matrix (they predate per-vibe features) and the real matrix is restored in the "Migration 0014" section. `scripts/check-sql.mjs`: new internal tables registered. `docs/DEPLOY_RAILWAY.md`: corrected the Railway config path to `/apps/api/railway.json`.

## 4. The owner's five requests: status, findings, remaining work

### Request 1. Rebrand SideQuest to **Waypoint**: NOT STARTED
Decisions already made (change only if the owner objects):
* Change **everything users see**: display name, onboarding/sign-in/profile text, push and inbox copy (they say "Open SideQuest"), the public legal pages (`APP_NAME` default in `apps/api/src/config.ts`, currently `'SideQuest'`), the admin page title, store-listing text, docs and the guide, and the Supabase email template text ("Your SideQuest code").
* **Keep** internal identifiers: the Expo `slug` (`sidequest`; changing it breaks the link to the owner's existing Expo project), the npm scope `@sidequest/*`, repo folder name.
* **Android package id `app.sidequest.android`:** it is permanent on Google Play once uploaded and must match Firebase's `google-services.json`. **Ask the owner** whether they have uploaded to Play or set up Firebase. If neither, they may change it to `app.waypoint.android` now (edit `app.json`, `apps/mobile/test/legal.test.ts`, re-download `google-services.json`). If either, keep it and explain it is invisible to users.
* `NEUTRAL_THEME.name` is already `'Waypoint'`. The app icon and splash images in `apps/mobile/assets/` may contain the old name: tell the owner, because images cannot be edited by me.
* Find occurrences with `grep -rn "SideQuest" apps packages docs supabase --include=*` and fix tests that assert the old name.

### Request 2. Notifications: DIAGNOSED, NOT CODED
Root causes found by reading `apps/mobile/src/lib/push.ts` and `src/features/PushPrompt.tsx`:
1. The **only** place that asks for notification permission is `PushPrompt`, a card that must be tapped. Android 13+ needs the runtime prompt, so most people never grant it.
2. `enablePush` **swallows every failure** (permission denied, Firebase not configured, upload failed) into a generic result, so nobody can tell why it is not working.
3. The Android **`safety` channel is created at default importance**; safety alerts need high importance.
4. Likely owner-side causes (cannot be checked by me): `google-services.json` missing from the build or `googleServicesFile` not in `app.json`; `FCM_SERVICE_ACCOUNT_JSON` not set on **both** Railway services; Supabase database webhooks (`message-created`, `notification-created`) not created; app not rebuilt after adding Firebase.

Planned work (with tests):
* API: `POST /v1/push/test` (sends a test push to the caller's registered tokens; returns `{tokens, sent, error}`; rate limited) and `push: boolean` in `GET /v1/config` (is FCM configured). `NoopPushSender` means "not configured".
* Mobile: `enablePush` returns a **reason** (`denied`, `blocked_in_settings`, `no_firebase`, `token_upload_failed`, `ok`); a **Notifications** section on the privacy screen showing permission, token registered, server configured, with a **Send test notification** button and plain advice for each failure; ask for permission at the end of onboarding; channels `safety` and `messages` at HIGH importance.
* Guide Part 8B: a troubleshooting table keyed to those reasons.

### Request 3. Location not working in the APK: DIAGNOSED, NOT CODED
Root cause: `app.json` **blocks `ACCESS_FINE_LOCATION`** (design: approximate location only) while Expo's `requestForegroundPermissionsAsync` asks for fine and coarse together. On Android 12+ a request that includes an undeclared permission can be denied outright. `app/(onboarding)/basics.tsx` then hides the real error behind a generic "type your city instead" message. (I could not reproduce on a device; this is the best-supported explanation from the code and Android behaviour.) Reverse geocoding also needs Google services.

Planned fix:
* Manifest: **declare both fine and coarse**; keep `ACCESS_BACKGROUND_LOCATION` blocked; update `apps/mobile/test/legal.test.ts` accordingly (it currently asserts fine is blocked and that exactly coarse and notifications are the dangerous permissions).
* **Privacy stays**: request low accuracy and **round to 2 decimal places on the device before sending** (the server already rounds in `set_approx_location`). Update Data safety guidance: "approximate location" only.
* `core/location-core.ts` (pure: classify results into `granted | denied | blocked_in_settings | services_off | timeout | geocode_failed | error`) and `lib/location.ts` (uses expo-location with `getLastKnownPositionAsync` first, then `getCurrentPositionAsync` with a timeout). Show the **specific reason** with the right action (Open settings, turn on location, type a city). **Manual fallback:** forward-geocode a typed city (`Location.geocodeAsync`) or save only the city.
* Add **Update my location** to the privacy screen (today location is only set during onboarding and when creating plans), and a **Location status** line for diagnosis.
* Call sites to update: onboarding basics, `app/open-call/new.tsx`, `app/activity/new.tsx` (grep `expo-location`).
* Tests: core unit tests; render tests need an `expo-location` mock in `apps/mobile/test/render/mocks/`.

### Request 4. A different theme per vibe, and different features per vibe: DB + SHARED DONE, APP NOT DONE
Done and tested:
* `MODE_THEMES`: six distinct dark themes (Rose = serious_dating, Midnight = hookups, Ocean = friendship, Lavender = post_marital, Neon = experimentation, Ember = adventures) plus the neutral Waypoint theme. Tests prove every theme meets readability (text 7:1, muted 4.5:1, button label 4.5:1), accents and backgrounds are visibly distinct, and the button label colour is chosen automatically.
* `MODE_FEATURES` (my proposal, the owner has not approved it; it is one table to edit): `serious_dating`: activities, double_dates, games, wingperson, together. `hookups`: none. `friendship`: open_calls, activities, circles, roulette, double_dates, games, wingperson. `post_marital`: activities, circles, double_dates, games, wingperson, together. `experimentation`: circles, games, together. `adventures`: open_calls, activities, circles, roulette. **Always on in every vibe:** discover and likes, chat and invitations, calendar, and all trust and safety tools.
* Migration 0014: table `mode_features` (function-only) and `mode_has(mode, feature)`; the live `join_roulette`, `create_open_call`, `post_double_date` and `start_game` each got one added line that refuses with `42501 unavailable` outside the right vibe. **Circles, activities, wingperson and Together are not vibe-scoped in the database**, so the app must hide them. A shared test fails if the SQL seed and the TypeScript matrix differ. Smoke tests prove the refusals.

Remaining (app):
* `src/lib/theme.tsx`: a `ThemeProvider` from `useModes().current` with `themeFor`, and `useTheme()`. **`src/design/ui.tsx` uses static `colors` baked into `StyleSheet.create` at load time**, so the kit must read the theme at render time: `Screen` (background gradient from `bgTop` to `bg`), `Button` (gradient `accent` to `accent2`, label colour `onAccent`), `Chip`/`Segmented`/`ProgressBar`/`Pill` (selected states use `highlight`), `Card` (surface and border), the tab bar in `app/(tabs)/_layout.tsx`, and the vibe picker (show `mood` and `modeFeatureList`). Neutral theme before a vibe is chosen.
* `useFeature(feature)` = `modeHas(current, feature)`. Gate: the Circles tab (hide it when the vibe has none of circles, roulette, double_dates; show only the available panels), the entry points for open calls and activities (find them in `app/(tabs)/discover.tsx` and the calendar), Safety hub rows for wingperson and Together, and the chat Play button (`src/features/GameButton.tsx`). Friendly "not part of this vibe" messages if reached by a deep link or notification.
* Render tests with `window.__mode` set to different vibes (the harness already supports `mode`).

### Request 5. Trust features that are **explicit to the user**: DB + SHARED DONE, API/ADMIN/APP NOT DONE
Done and tested:
* **Selfie photo verification (human-reviewed)**, migration 0015: functions `start_verification` (random pose, 30-minute window, 3 tries a day, needs an approved photo), `submit_verification` (path must be in the user's own folder), `my_verification`, moderator functions `mod_verification_queue`, `mod_verification_context` (pose and approved photo ids), `mod_review_verification` (reject needs a reason; approval sets `profiles.verified_at`, which clients cannot write; audited; notifies the user with kind `verification_result`). Private bucket `verification-selfies` (clients can only insert into their own folder; they cannot read back).
* `verified_flags(uuid[])`: which people are verified (never reveals blocked or inactive people).
* `my_photo_issues()` and `profile_photos.rejection_reason`: a rejected photo now carries the moderator's reason, readable by its owner. `mod_review_photo` now requires a reason to reject.
* `chat_trust(conversation)`: facts about the other person in a one-to-one chat: `verified`, `account_age_days`, `repeated_message_to` (the same 15+ character message sent to that many different conversations in 24 hours).
* `packages/shared/src/trust.ts` (pure, tested with benign and malicious cases): `assessMessageText(text, {earlyInConversation})` returns flags (`money`, `investment`, `off_platform`, `link`, `contact_info`, `pressure`, `romance_scam`, `explicit`), each with a plain-language title and advice, a level (`none`, `caution`, `warning`) and an `explicit` boolean. It says "may" (it can be wrong both ways). `describeAccountTrust` and `accountLooksSuspicious` turn `chat_trust` into lines the UI shows.

Remaining (in this order):
1. **API:** `POST /v1/admin/selfie-url` (moderators only; signs a 2-minute link to `verification-selfies`); extend `photoForReview` (in `PgStore` and `MemoryStore`) so moderators may also view the **approved profile photos of a user with a pending verification**; a worker job `purgeSelfies` that **deletes the selfie file and nulls `selfie_path` shortly after a decision or expiry** (privacy by design); add `'verification-selfies'` to `USER_FILE_BUCKETS` in `apps/api/src/supabase-admin.ts` so account deletion removes it. Tests like the existing `data-jobs` and `admin-page` ones.
2. **Admin page** (`apps/api/src/admin-script.ts`, `admin-page.ts`): a **Verification** tab (queue, context, selfie beside the profile photos, approve or reject with a reason). Keep the rules: textContent only, nonce CSP, tests including hostile text in jsdom.
3. **App:** `src/lib/db.ts` wrappers (`startVerification`, `submitVerification`, `myVerification`, `verifiedFlags`, `chatTrust`, `myPhotoIssues`) **plus the contract test** (`test/db-contract.test.ts` checks every wrapper against the SQL); `app/safety/verify.tsx` (explain what and why, take the selfie with `expo-image-picker` camera, show the pose, upload to `verification-selfies/<uid>/<id>.jpg`, `submit_verification`, status screen with the rejection reason and a Try again); camera permission wording in the plugin config; a **Verified** badge on discover cards, likes, the person screen and the chat header (via `verified_flags`); the **chat trust card** at the top of a one-to-one chat (via `chat_trust` and `describeAccountTrust`, with a prominent warning when `accountLooksSuspicious`); a **message warning banner** under each incoming message that `assessMessageText` flags (title, advice, buttons **Report**, **Block**, **I know them**; for `explicit`, hide the text behind "This may contain explicit content. Show anyway" and offer **Block and delete chat**); show `my_photo_issues` reasons in `app/edit-profile.tsx`. Render tests for each.
4. Update `docs/START_TO_FINISH_GUIDE.md`, the privacy policy and terms text (`apps/api/src/public-pages.ts`: selfies are deleted after the decision; scam and explicit checks run on the device), and the Data safety table.

**Explicit limitation to tell the owner:** **images are NOT automatically scanned for explicit content or scams.** That needs an external image-safety service (or a hosted model); I cannot test one here, and an untested adapter would be misleading. Today: profile photos wait for a human (`PHOTO_MODERATION=required`), chat photos are hidden until the recipient opens them, and any recipient can report or block. If the owner wants automation, design a provider interface (`scan(imageUrl) -> labels`), run it on upload, store the result, and show the same explicit warning flow; choose a provider together.
Also explicit text warnings and scam cues are **heuristics**: tell the owner they will have false positives and false negatives, which is why the user always sees why a warning appeared and can dismiss it.

## 5. Decisions already made (so they are not reopened by accident)

* Per-vibe features are enforced **in the database where the database knows the vibe**, and by the app elsewhere.
* Verification is **manual review first** (works today, no vendor, no per-check cost). An automated face-match provider can be added behind the same functions later.
* Warnings are **shown, never silent**: the user sees what looked wrong and chooses. The first time a pattern appears they are told.
* The default (neutral) button gradient was darkened for readability; this changes the owner's current look very slightly.
* `PHOTO_MODERATION` must be `required` for launch (photos wait for human approval at `/admin`); `off` is for testing only.
* Free tier forever: no paywalls, caps or blurring.

## 6. Environment facts and gotchas

* **Sandbox:** Node 22, root, `apt` and the npm registry were reachable (earlier sessions said no network: always re-check). `corepack enable` then `pnpm install` works and is the simplest setup. **Postgres processes get killed between tool calls**: use `scripts/sandbox/ensure-pg.sh` (all scripts call it). Install once with `scripts/sandbox/install-postgres.sh`. Set the postgres password to `pgtest` for the integration tests.
* **Mobile checks:** `pnpm install` gives the real Expo packages (pinned versions in `apps/mobile/package.json`). The render harness (`apps/mobile/test/render/`) bundles real screens with `react-native-web` and mounts them in jsdom with fakes for Supabase, expo-router, session, modes, icons, gradient and safe-area. Add a mock there for any new native module (for example `expo-location`, `expo-image-picker`). Clicking helper `click(text)` taps the closest button and waits for a visible reaction.
* **`allowedSegments`** in `apps/mobile/src/core/routing.ts` lists every top-level route a signed-in person may open; a new top-level route must be added there (and to `NEW_SCREEN_SEGMENTS`) or the gate redirects away.
* **Every database call in the app goes through `src/lib/db.ts` with one call per line**; `test/db-contract.test.ts` parses it and checks names, argument names, required arguments and grants against the migration SQL. Keep that format.
* **Every notification kind** must have push copy (API) and inbox copy (mobile); both are exhaustive records.
* Test counts are asserted loosely; if you add tests, update the numbers in `docs/PROGRESS.md` and `docs/HANDOVER.md`.
* **Stale documents to fix:** `docs/PROGRESS.md` (progress table is at v10 wording), `docs/HANDOVER.md`, `docs/START_TO_FINISH_GUIDE.md` (brand and location/notification steps), `docs/ANDROID_RUN.md`.
* **Known gaps (also in `docs/SAFETY_LEDGER.md`):** a suspended person can delete and re-register; reports lose their link to a deleted person; deletion erases a person's sent messages from other people's chats; private circles cannot be joined (no invite function); roulette areas are free text; data export (`export_user_data`) does not yet include verification records; the Docker build of the API on Railway was never run by me (the owner's deployment suggests it works).

## 7. Things to ask the owner early

1. **Package id:** have you uploaded to Google Play or set up Firebase? (decides whether to rename `app.sidequest.android`).
2. **Feature matrix:** is the table in section 4 right for each vibe? (one table to change).
3. **Verification:** is human review of selfies acceptable for now (you or your team approve at `/admin`)?
4. **Diagnostics:** if notifications or location still fail after the next build, send the on-screen status text (the new diagnostics will name the exact reason).
5. **Vibe wording:** "Hookups" and "Experiment" are the sensitive labels for Google Play review; do they want them renamed?

## 8. Suggested order for the next session

1. API: push test endpoint, config flag, selfie url, purge job; tests.
2. Mobile: location and notification fixes with diagnostics (requests 2 and 3), manifest change.
3. Theme provider and UI kit refactor; feature gating; vibe picker (request 4).
4. Trust UI: banners, trust card, badge, verification screen, photo reasons; admin Verification tab (request 5).
5. Rebrand to Waypoint (request 1) last, as one sweep, so tests are changed once.
6. Update docs, guide, privacy and terms text; package `sidequest-v13.zip`; verify from a fresh unzip; report progress honestly.
7. At 100%, the community-quality design discussion.

## 9. Appendix A: how to use the new shared modules (working code)

```ts
import { themeFor, modeHas, modeFeatureList, FEATURES, assessMessageText, describeAccountTrust, accountLooksSuspicious, contrastRatio } from '@sidequest/shared';

const t = themeFor('friendship');           // { name:'Ocean', bg, bgTop, surface, surfaceRaised, border, accent, accent2, highlight, onAccent, mood }
modeHas('hookups', 'roulette');             // false
modeFeatureList('adventures');              // [{ title:'Open calls', blurb:... }, ...]

const a = assessMessageText('text me on telegram, I need money', { earlyInConversation: true });
// a.level === 'warning'; a.explicit === false
// a.flags[0] -> { code:'money'|'off_platform'|..., level:'warning'|'caution', title, advice }

const lines = describeAccountTrust({ verified: false, accountAgeDays: 1, repeatedMessageTo: 5 });
// [{label:'Not photo verified',tone:'neutral',detail}, {label:'Joined 1 day ago',tone:'warn',detail}, {label:'Sent the same message to 5 people today',tone:'warn',detail}]
```

## 10. Appendix B: the new database functions the app and admin will call

| Function (all need a signed-in user unless marked) | Arguments | Returns |
|---|---|---|
| `start_verification()` | none | `{id, pose, expires_at}` (errors with code `22023` and a readable message, or `SQ431` for too many tries) |
| `submit_verification(p_id, p_path)` | verification id, `<uid>/<id>.jpg` | void |
| `my_verification()` | none | `{verified, verified_at, latest:{id,status,pose,reject_reason,expires_at}}` |
| `verified_flags(p_ids uuid[])` | up to 100 ids | set of verified ids |
| `chat_trust(p_conv)` | direct conversation id | `{verified, account_age_days, repeated_message_to}` |
| `my_photo_issues()` | none | rows `(photo_id, status, reason)` for my pending or rejected photos |
| `mode_has(p_mode, p_feature)` | text, text | boolean (used inside other functions) |
| moderator: `mod_verification_queue(p_limit)` | | rows `(verification_id, submitted_at, pose, approved_photos)` |
| moderator: `mod_verification_context(p_id)` | | `{id, pose, submitted_at, photo_ids[]}` |
| moderator: `mod_review_verification(p_id, p_approve, p_reason)` | | void |
| moderator: `mod_review_photo(p_photo, p_approve, p_notes)` | | void (reason now required to reject) |

Client wrapper format (one call per line, required for the contract test):
```ts
startVerification: () => call<{ id: string; pose: string; expires_at: string }>('start_verification'),
submitVerification: (id: string, path: string) => call<void>('submit_verification', { p_id: id, p_path: path }).then(none),
verifiedFlags: (ids: string[]) => call<string[]>('verified_flags', { p_ids: ids }),
chatTrust: (conv: string) => call<{ verified: boolean; account_age_days: number; repeated_message_to: number }>('chat_trust', { p_conv: conv }),
```

## 11. Kickoff prompt for the new chat (paste this with the two attachments)

> You are continuing a build I started in earlier sessions: **Waypoint** (formerly SideQuest), a free-forever social and dating app for adults 18+ (Android first with Expo/React Native; Supabase + a Node API/worker on Railway). I am attaching `sidequest-v12.zip` (the latest checkpoint) and `HANDOFF_WAYPOINT.md`. Unzip, read `docs/HANDOFF_WAYPOINT.md` first, then `docs/PROGRESS.md` and `docs/SAFETY_LEDGER.md`. Do not rely on anything else.
>
> How to work with me: you write and test the code yourself, end to end, across as many turns as needed. Report progress as a percentage out of 100 each turn (currently **84**) and attach the updated full zip at the end of every step with an incrementing name (`sidequest-v13.zip`, ...). Be strictly honest: separate "tests pass here" from "written but never run". Keep replies short: what changed, what is verified, what is not. The shell is plain sh (no brace expansion, no here-strings); use Python heredocs for multi-file edits. I have already deployed the app end to end and I am not a developer, so explain things plainly and step by step.
>
> First recreate the environment and confirm the baseline (`corepack enable && pnpm install && pnpm test && pnpm typecheck && pnpm check:sql`; expect shared 49, API 116 + 8 skipped, mobile 110, SQL checker clean), then follow section 8 of the handoff. Keep the design rules in section 2. My five requests are in section 4: rebrand to Waypoint, notifications, location, a different theme and feature set per vibe, and explicit trust features (selfie verification, scam/bot warnings, explicit-content warnings with delete or block). Start with the API and diagnostics work, then tell me the new progress percentage.
