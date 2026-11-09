# v13 changes (on top of v12)

Honest status: **written and unit-tested where this environment could run tests; not built, not run on a phone, not run against a hosted Supabase.**
Ran here: shared 50/50, API 112 passed (17 skipped need `pg`/`jsdom`), mobile logic 106 passed, SQL checker clean, TypeScript syntax check on all 50 changed files, shared typecheck.
NOT run here (no network, so no `pnpm install`): the full typecheck of API and mobile, the jsdom render tests (`render.test.ts`, including the new ones), `pg-integration`, the native build.

## What changed
1. **API**: `POST /v1/push/test` (sends one harmless test to your own phones, 5 per 10 minutes) and `push` in `GET /v1/config`. Tests: `apps/api/test/push-test.test.ts`.
2. **Notifications (mobile)**: every outcome now has a named reason (denied, blocked in Settings, no Firebase in this build, could not save token). Asked at the end of onboarding, in the Chat tab, and on Privacy. Messages and safety channels are HIGH importance. Privacy screen has a status card and a "Send test notification" button.
3. **Location (mobile)**: one helper (`src/lib/location.ts`): permission, services on, last-known position, 15 s fix, rounded to ~1 km on the phone, named failure reasons, typed-city fallback. "Update my location" on Privacy. `ACCESS_FINE_LOCATION` is now declared (background stays blocked).
4. **Per-vibe look and features**: UI kit, tab bar, vibe tiles and sheet follow the vibe's theme. Discover tabs, Circles panels, Safety rows and the chat game button follow the feature table; deep links to a missing feature show a friendly screen. Vibe picker shows each vibe's mood and what it includes.
5. **Trust (without selfies)**: scam and explicit-content warnings on received messages (explicit text starts hidden; Report, Block, "Block and remove chat", "I know them"), and a chat trust card (new account, copy-paste messaging). "Verified" wording is off via `VERIFICATION_ENABLED = false`.
6. **Names**: "Hookups" is now "Casual", "Experiment" is now "Explore" (display only; ids unchanged). New migration `0016_mode_labels.sql`.

## You must do
- Run SQL `0014`, `0015`, `0016` in Supabase if you have not (the trust card and vibe features need 0014/0015).
- Firebase (guide Part 8B) is the reason notifications cannot work yet: add `google-services.json`, `googleServicesFile` in `app.json`, `FCM_SERVICE_ACCOUNT_JSON` on BOTH Railway services, then rebuild the app.
- Android keeps the old importance of channels already created on a phone. To see HIGH importance on a test phone, uninstall and reinstall the app.

## Known gaps
- Rebrand to Waypoint: not done (plan delivered separately).
- Selfie verification: parked (plan delivered separately). Admin Verification tab, selfie endpoints and purge job were NOT built. Migration 0015 tables stay dormant.
- About 55 icon/accent colours elsewhere in the app still use the fixed purple instead of the vibe colour.
- Photo rejection reasons screen not built. "Block and remove chat" blocks the person and removes the chat from your list; it does not erase the stored message history.
- Chat game button follows the vibe you are currently in, not the vibe the conversation belongs to.
