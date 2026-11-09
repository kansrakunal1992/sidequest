# Adhoc check: why the rebuilt app crashes, and what this zip fixes

Checked on 9 November 2026 against `sidequest.zip` (your project, last commit `2e06ec4`).

## What was wrong (all confirmed by running the checks on your own dependencies)

| # | Finding | Effect | Fix in this zip |
|---|---|---|---|
| 1 | **`packages/shared` is missing the v12 files**: `mode-theme.ts`, `mode-features.ts`, and `index.ts` does not export them or `trust.ts`. Also the `verification_result` notification kind and 2 small v12 edits are missing. | Every themed screen calls `themeFor(...)`, which does not exist, so the app crashes on start. The API also fails to type-check. | Added/updated all of them |
| 2 | **`app.json` has no `googleServicesFile`**, although `google-services.json` is in `apps/mobile`. | The build ignores your Firebase file, so push can never register. | `"googleServicesFile": "./google-services.json"` added |
| 3 | **`expo-system-ui` is missing** from `apps/mobile/package.json` (the app is set to dark mode). | Build warning or error on Android | Added `expo-system-ui ~6.0.9` (matches your Expo 54) |
| 4 | **Your Firebase Admin key is committed to git** (`waypoint-a8822-firebase-adminsdk-fbsvc-….json`, first committed in `2e06ec4`) and the repo has a GitHub remote. | Anyone who can read the repo can send notifications as your app and use that service account. | `.gitignore` now blocks such files. **You must rotate the key (Part 3).** |
| 5 | Pending items from my list: the fixed purple colours, and photo rejection reasons. | Cosmetic / missing feature | Done (see Part 4) |
| 6 | Theme hooks threw an error if used outside the mode provider | A possible crash on an error screen | Now falls back to the neutral look |

## What I ran (on a copy of YOUR project with these fixes, using YOUR node_modules)
- Type-check: shared, API and mobile all clean (before the fixes: 2 API errors and many mobile errors, which reproduces your crash).
- Tests: shared 50 passed; API 134 passed (8 need a live Postgres and were skipped); mobile 143 passed, including all 31 screen-rendering tests.
- A real Android bundle (`expo export`) built successfully, and the resolved config shows `googleServicesFile`.
- **Not run:** the app on a phone, the EAS cloud build, Railway, Supabase, Didit. So I cannot promise the crash is gone until you build it, but the cause I found is the kind that crashes at start-up.

## Part 1. Apply the files
1. In the project folder run `git status`. Commit or stash anything you want to keep.
2. Unzip `adhoc-check-version.zip` **over the project folder** (the one that contains `apps`, `packages`, `supabase`, `docs`). Replace when asked. It does not touch `eas.json`, `.env`, `google-services.json` or `pnpm-lock.yaml`.
3. Run:
   ```
   corepack enable
   pnpm install
   pnpm test
   pnpm typecheck
   pnpm check:sql
   ```
   `pnpm install` will **change `pnpm-lock.yaml`** because `expo-system-ui` is new. That is expected. **You must commit the lockfile**, or the cloud build will fail.
4. `git add . && git commit -m "adhoc check fixes" && git push`

## Part 2. Rebuild the app
```
cd apps/mobile
eas build -p android --profile preview --clear-cache
```
Uninstall the old app from your phone first (old notification channels and old data can confuse tests), then install the new build.

If it still closes on start-up, connect the phone by USB and run `adb logcat *:E | grep -i -E "sidequest|ReactNative|AndroidRuntime"` right after opening it, and send me the red lines.

## Part 3. Fix the leaked Firebase key (do this today)
1. Firebase console → project **waypoint-a8822** → ⚙ Project settings → **Service accounts** → **Manage service account permissions** (opens Google Cloud) → **Keys**. **Delete the key** whose id starts with `007ece1bb5` (it is the one in the file name).
2. Back in Firebase → Service accounts → **Generate new private key**. Keep the downloaded file **outside the project folder**.
3. Railway → **API service** → Variables → set `FCM_SERVICE_ACCOUNT_JSON` to the **entire contents** of the new file (open it in a text editor, copy everything). Do the same on the **worker** service. Railway redeploys.
4. Remove the old file from git: `git rm --cached waypoint-a8822-firebase-adminsdk-fbsvc-007ece1bb5.json`, delete the file from your folder, then commit and push. (The old key stays in git history, which is harmless once it is deleted in step 1.)
5. Test: in the app go to **Safety and privacy → Notifications → Turn on notifications → Send test notification**. It will tell you exactly what is missing if it fails.

## Part 4. What is now done that was pending
- Vibe colours: icons, switches, spinners, links, bubbles and buttons now follow the vibe on 20 files. Deliberately left alone: the sign-in and loading screens (no vibe yet) and the green/purple status colours for "confirmed/waiting".
- Photo rejection reasons: Edit profile now says which photo was not approved and why (needs SQL `0015`; if it is missing, photos still show).

## Part 5. Still pending (not done here)
- **Waypoint rebrand** (plan in `PLAN_REBRAND_AND_SELFIE.md`).
- Didit setup (guide `GUIDE_V14_PHOTO_VERIFICATION.md`, Part C) if you have not done it yet.
- Google Play Data safety form and legal wording review.
- Chat game button follows the vibe you are in, not the vibe of the conversation.
- "Block and remove chat" blocks and hides the chat; it does not erase stored message history.
- Android keeps old notification-channel importance on phones that already had the app; a fresh install fixes that.
- Images are not scanned automatically for explicit content (needs an external service).
