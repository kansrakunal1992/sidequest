# v15 guide: SideQuest is now Waypoint (step by step)

This update goes **on top of the adhoc-check zip** (which went on top of v14). Apply them in that order.

Honest status: code, tests and a real Android bundle pass on a copy of your project (shared 53, API 134 with 8 needing a live Postgres, mobile 143, all type-checks clean). **Not done by me because I cannot:** build in the EAS cloud, open the app on a phone, edit Supabase, Railway, Play Console or Didit, or search trademark registers.

---

## Part A. What changed, and what I deliberately did not change

**Changed (everything a person can see)**
- Phone launcher name: **Waypoint**. New icon (a map pin in the same purple-to-pink gradient), adaptive icon and splash screen. The welcome screen logo and name.
- All app text, error messages, notification text ("Open Waypoint to read it."), the calendar file (`waypoint-<id>.ics`), permission pop-ups (photos, location), the moderator page title, the privacy/terms/delete pages (default name), docs and guides (including the Play listing title `Waypoint: Meet & Do Things`, 26 characters).
- A test (`packages/shared/test/brand.test.ts`) now fails if the old name creeps back into app, API or shared code.
- I also fixed a typo in your README (a heading had become "V12erify").

**Kept on purpose (changing these would break things)**

| Kept | Why |
|---|---|
| Package id `app.sidequest.android` | Permanent once uploaded to Google Play; must match your `google-services.json`. People never see it. |
| `slug` = `sidequest` | The identity of your EAS project and builds. |
| Link scheme `sidequest://` | Sign-in and Didit return links use it; Supabase and Didit are already set up with it. Changing it means touching both. |
| `@sidequest/shared` and the folder names | Internal code names only. Renaming risks breaking every import for no benefit. |
| Calendar event ids ending `@sidequest.app` | They are invisible; changing them would make already-saved calendar events duplicate. |
| Old SQL migration files | They are history. One database error text still says the old name, but the app never shows it (it shows its own message). |
| GitHub repo, Railway service names | Not user-visible. Optional to rename later. |

## Part B. Put the code in
1. `git status`. Commit anything you want to keep.
2. Unzip `waypoint-rebrand-version.zip` **over the project folder**. Replace when asked. It does not touch `eas.json`, `.env`, `google-services.json` or `pnpm-lock.yaml`.
3. There are **no new packages**, so no lockfile change this time. Run:
   ```
   pnpm test
   pnpm typecheck
   pnpm check:sql
   ```
4. `git add . && git commit -m "Rebrand to Waypoint" && git push`

## Part C. Outside the code (in this order)

### C1. Railway: the public pages
Railway → **API service** → Variables → add or change `APP_NAME` = `Waypoint`. (It controls the name on `/privacy`, `/terms`, `/delete-account`.) It redeploys by itself. Open `https://YOUR-RAILWAY-ADDRESS/privacy` and check it says Waypoint. The worker needs no change.

### C2. Supabase: the sign-in email
1. Supabase → **Authentication → Email Templates**. For each template you use (Magic Link and Confirm signup), change the subject to `Your Waypoint code` and the body to something like: `Your Waypoint code is {{ .Token }}`. Keep the `{{ .Token }}` part exactly.
2. **Authentication → SMTP Settings** (name may differ slightly): set **Sender name** to `Waypoint`. Leave the sender address as it is unless you want a new one.
3. Optional: rename the project in Supabase → Project Settings → General. It changes nothing for users.

### C3. Didit (selfie check page)
Open the Didit console and look for **Branding** (or Appearance) in your organization or workflow settings. Set the name to Waypoint and upload `apps/mobile/assets/icon.png` as the logo, so the page people see during the selfie check matches. I could not see your console, so the exact menu name may differ.

### C4. Firebase (optional)
Project settings → General → the Android app nickname can say Waypoint. Nothing breaks either way. Do **not** change the package name.

### C5. Google Play Console
You have already done guide steps up to 7.6, so the Play app may already exist under the old name.
1. Play Console → your app → **Grow users → Store presence → Main store listing** (menu names move around). Change **App name** to `Waypoint: Meet & Do Things` (30 characters is the limit).
2. Replace the **App icon** with `docs/store/play-store-icon-512.png` (included in the zip; 512×512).
3. Replace the **Feature graphic** with `docs/store/play-feature-graphic-1024x500.png`.
4. Update the short and full descriptions from the guide's Appendix (already renamed in `docs/START_TO_FINISH_GUIDE.md`).
5. Screenshots: take new ones from the rebuilt app (old ones show the old logo on the welcome screen).
6. The package id stays `app.sidequest.android`. It is not shown to users.
7. Privacy policy URL stays the same; it now says Waypoint (C1).

### C6. Check the name is free to use (I could not do this)
"Waypoint" is a common word and may be used by other apps or registered as a trademark. Before launch: search Google Play and the App Store for "Waypoint", and search the Indian trademark register (IP India public search) and any country you will launch in. If you plan to spend money on this brand, ask an IP professional. If there is a clash, the cheapest time to change the name is now, before the first public release.

### C7. Optional later
Rename the GitHub repo and Railway services. If GitHub asks, GitHub keeps redirecting the old repo address; Railway reconnects automatically after a repo rename, but check the deploy once.

## Part D. Rebuild and check
```
cd apps/mobile
eas build -p android --profile preview --clear-cache
```
Install the new APK **over** the old app (same package id, so your data stays). Then check:
- [ ] Launcher shows **Waypoint** with the pin icon; splash shows the pin.
- [ ] Welcome screen says Waypoint with the pin logo.
- [ ] Sign-in email says "Your Waypoint code is …".
- [ ] Safety and privacy → Notifications → Send test notification arrives.
- [ ] Permission pop-ups (photos, location) say Waypoint.
- [ ] Download a calendar invite: file is named `waypoint-….ics`.
- [ ] `/privacy` on your Railway address says Waypoint.

If the launcher still shows the old icon or name, uninstall the app and install again; some phones cache them.

## Part E. Still parked (as agreed)
Play Data safety form and legal wording review; chat game button uses your current vibe, not the conversation's; "Block and remove chat" does not erase stored history; old phones keep old notification-channel importance; images are not scanned automatically for explicit content.
