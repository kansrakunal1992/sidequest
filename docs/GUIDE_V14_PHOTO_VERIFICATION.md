# v14 guide: automatic photo verification (Didit), step by step

This update goes **on top of v13**. It adds an optional "Photo verification" check: a person takes a live selfie, a provider checks it is a real person and matches their profile photo, and the app shows a verified badge. **No human reviews anything.** Everything is switched off until you add the Didit keys in Part C, so deploying the code first is safe.

Honest status: written and unit-tested in my sandbox (it has no network). **Not run against the real Didit service, Supabase, Railway or a phone.** Part D tests it in Didit's free sandbox before any real money or real people are involved.

---

## Part A. Which vendor, and why (prices read on 9 November 2026; they change, so confirm on the vendor page)

| Vendor | Free allowance | Why / why not |
|---|---|---|
| **Didit (chosen)** | Free plan gives **US$10 of credit every month** (new from 1 Nov 2026; older pages still say "500 free checks", the newer pricing page replaces that). A selfie check (liveness + face match) costs about **US$0.10**, so roughly **100 free checks a month**. You pay only for checks that finish. Sandbox is free (500 test sessions a day). No card needed to start. | Hosted selfie page (no camera code to write), certified liveness, simple REST API and signed webhooks, can delete the session afterwards. |
| Microsoft Azure Face | 30,000 free transactions a month | Face **verification** is a "Limited Access" feature: you must apply to Microsoft and be approved. Liveness is paid. Too slow and uncertain for you now. |
| Amazon Rekognition | No permanent free tier (per the sources I read) | Needs AWS SDK work inside the app. Not free. |
| Face++ | About 1,000 calls a day (third-party report) | Chinese company, no hosted liveness page; data-transfer and policy risk for an Indian app on Play. Not recommended. |
| Self-hosted open source (e.g. CompreFace) | Software is free | You run the servers; no certified liveness, so easy to fool with a photo or video. Not recommended. |
| Perfios (India) | 1,000 free **sandbox** credits only | Production is paid and needs sales contact. A later option. |

**Two honest warnings about Didit's free plan**
1. The $10 monthly credit is described as being for organizations that **signed up with a work email**. Sign up with an address on your own domain (for example `you@quorumvault.org`), not Gmail. I could not confirm what happens with a personal address.
2. When the credit is used up, live checks **stop** until you top up (minimum top-up US$50, lasts 12 months) unless you turn on auto top-up. Leave auto top-up **off**. The app also stops starting checks after `VERIFY_MONTHLY_CAP` (default 90) per month, so people get a friendly "paused" message instead of an error.

---

## Part B. Put the new code in your project

1. **Back up first.** In your project folder, run `git status`. It should say nothing to commit. If it lists changes, run `git add . && git commit -m "before v14"`.
2. Download `sidequest-v14-changed-files.zip` and **unzip it on top of your project folder** (the folder that contains `apps`, `packages`, `supabase`, `docs`). Choose **Replace** when asked. The zip contains only new or changed files, in their right folders.
3. Check what changed: `git status`. You should see about 28 files (new: `apps/api/src/selfie-verification.ts`, `apps/mobile/app/safety/verify.tsx`, `supabase/migrations/0017_auto_selfie.sql`, tests, guides).
4. Run the checks:
   ```
   corepack enable
   pnpm install
   pnpm test
   pnpm typecheck
   pnpm check:sql
   ```
   There are **no new packages**, so `pnpm-lock.yaml` should not change. If anything fails, copy the red text and send it to me. (I could not run `typecheck` or the screen-rendering tests in my sandbox, so this is the first time they run for v13 and v14.)
5. Do **not** push yet. Do Part C first (SQL), then push.

## Part C. Everything outside the code

### C1. Supabase: add the new database changes
Open Supabase → your project → **SQL Editor** → New query. Run these files **in order, each once**, pasting the whole file and pressing Run. Skip any you already ran (the guide's table in Step 4.x has tick boxes):
`0014_mode_features.sql`, `0015_trust.sql`, `0016_mode_labels.sql`, **`0017_auto_selfie.sql`** (new).
You should see "Success. No rows returned" each time. If one says "already exists", that file was already run; move on.

### C2. Didit: create the account, workflow, keys and webhook
1. Go to **business.didit.me** and create an account with your **work email** (see warning 1). Stay on the **Free** plan.
2. Create an organization if asked. In the console, open **Workflows → Create workflow**. Choose the **Biometric Authentication** template. Make sure it has **Liveness** and **Face Match** switched on. Save/publish it and **copy the Workflow ID** (a long code with dashes).
3. Open **Settings → API & Webhooks**. Copy the **API Key**.
4. Still there, add a **webhook destination**:
   - URL: `https://YOUR-RAILWAY-ADDRESS/v1/hooks/didit` (same address as `EXPO_PUBLIC_API_URL`, then `/v1/hooks/didit`).
   - Version: **v3**. Subscribed events: **status.updated**.
   - After saving, copy the **secret** shown (called `secret_shared_key`). You only see it once, so paste it straight into your secrets sheet.
5. Do the first run with the **sandbox** key if the console offers separate sandbox and live keys (the docs say the sandbox is free and needs no card). Use live keys only after Part D passes.
6. Leave data retention and face-template retention at their **defaults**. The server already asks Didit to delete each session after the result.

### C3. Railway: add variables (API service only)
Railway → your project → the **API** service (not the worker) → **Variables** → New Variable. Add:

| Name | Value | Required |
|---|---|---|
| `DIDIT_API_KEY` | the API Key from C2 step 3 | yes |
| `DIDIT_WORKFLOW_ID` | the Workflow ID from C2 step 2 | yes |
| `DIDIT_WEBHOOK_SECRET` | the webhook secret from C2 step 4 | yes |
| `VERIFY_MIN_MATCH_SCORE` | `85` (higher = stricter, 50 to 99) | no |
| `VERIFY_MONTHLY_CAP` | `90` (checks started per month, all people) | no |

All three `DIDIT_` values must be set together; the server refuses to start with only some of them, and tells you which is missing. `SUPABASE_SERVICE_ROLE_KEY` must already be on the API service (it is, from Step 5.5). Do **not** add `VERIFY_RETURN_URL` unless you change the app's link scheme.
Railway redeploys by itself after you save variables.

### C4. Push the code
```
git add .
git commit -m "v14 photo verification"
git push
```
Railway builds from GitHub. Open the API service → **Deployments → View logs**. You should **not** see the line "DIDIT_* not set: selfie verification is OFF". Open `https://YOUR-RAILWAY-ADDRESS/privacy`: it should now contain a "Photo verification (optional)" section.

### C5. Rebuild the app
The v13 changes (location permissions, new screens) and v14 both need a new build.
```
cd apps/mobile
eas build -p android --profile preview
```
Wait for the build, open the link on your phone, install the new APK over the old one. (For the Play Store later, use `--profile production`.)

### C6. Google Play and legal
- **Data safety form** (Play Console → App content): add that the app collects **Photos** and, through the verification provider, **face data for fraud prevention and security**, that it is shared with a service provider, and that it is optional. Answer deletion honestly: the selfie is deleted by the provider after the result.
- Your privacy page already updates itself when `DIDIT_*` is set. Make sure the privacy policy URL in Play Console is that page.
- I am not a lawyer. India's DPDP Act treats face data as personal data needing clear consent; the consent screen is in the app, but have someone qualified read the wording before launch.

## Part D. Test it, in this order

1. **Sandbox end to end** (with the sandbox key): sign in with account A, make sure A has one **approved** profile photo with a clear face. Open **Safety and privacy → Photo verification → I agree, start the check**. The phone browser opens Didit's page. Complete the selfie. The app should return to the verify screen and show **"You are photo verified"** within a minute.
2. **Failure path**: repeat with account B, and use a different face (or cover your face). You should see a plain "did not match" or "could not confirm a live selfie" message and a **Try again** button.
3. **Limits**: after 3 starts in a day you should see "try again tomorrow".
4. **Badge**: from another account, open A's profile or chat. A should show the verified tick. The chat's trust card now says "Not photo verified" for B (it only appears once the server reports verification is on).
5. Switch Railway variables to the **live** Didit key, workflow and secret (a different set from the sandbox). Test once with your own account.
6. Check Didit's console: the finished sessions are gone or being deleted, and your balance went down by about US$0.10 per finished check.

## Part E. If something goes wrong

| What you see | Likely cause | Fix |
|---|---|---|
| No "Photo verification" row in Safety | `DIDIT_*` not set, or API has not redeployed | Check Part C3/C4; the row appears only when the server says it is on |
| "Not switched on yet" on the screen | Same | Same |
| "The verification service is not answering" | Wrong key, no credit left, or Didit down. Railway log says `provider unavailable: status_401` or `status_400` | Check the key; check balance in Didit console |
| "We could not use your profile photo" | Photo has no clear face, or is over 1 MB | Add a clear front-facing photo |
| "Add a clear photo… wait for it to be approved" | No approved photo | Approve it in `/admin → Photos` (or `PHOTO_MODERATION=off` while testing) |
| Stuck on "Waiting for the result" | Webhook not reaching you: wrong URL, secret mismatch, event not subscribed | In Didit console open the session and webhook log; the URL must be `…/v1/hooks/didit`; copy the secret again |
| Start fails with a server error | SQL `0017` not run | Run it (C1) |
| "Verification is paused" | Monthly cap reached | Raise `VERIFY_MONTHLY_CAP` after topping up, or wait for next month |
| Browser opens but never returns to the app | Didit may not accept the app's link as a return address | Come back to the app by hand; it checks the result when you return. Tell me and I will change the return flow |

## Part F. Still outstanding from v13
- **Firebase** (guide Part 8B) is why notifications could not work. Do it before testing notifications.
- Rebrand to Waypoint is still a plan (see `PLAN_REBRAND_AND_SELFIE.md`).
