> The complete beginner path (accounts, hosting, store listing) is `docs/START_TO_FINISH_GUIDE.md`. This file is the shorter technical reference for running on a phone.

# Running SideQuest on an Android phone

You need: Node 22+, pnpm (`corepack enable`), a free Expo account, and an Android phone (or emulator). The API and database from `docs/DEPLOY_RAILWAY.md` should already be running.

## 1. One-time Supabase settings
1. **Authentication > Providers > Email**: enable it. Keep "Confirm email" on.
2. **Authentication > Email Templates > Magic Link**: the app signs in with a one-time code, so make the template show it. Replace the body with something like `Your SideQuest code is {{ .Token }}`.
3. Make sure migrations `0001` to `0013` are applied and `supabase/tests/rls_smoke.sql` passes. The app relies on `save_onboarding` / `finish_onboarding` (0005), the discovery, like and visitor functions (0006), chat (0007), and Open Calls, Activities and group chat (0008).

## 2. Install
```
pnpm install
cd apps/mobile
cp .env.example .env        # fill in the three values
npx expo install --fix      # aligns every Expo package to the installed SDK
npx expo-doctor             # should report no problems
```
`package.json` pins `expo ~54` and leaves other Expo packages at `*` on purpose: `expo install --fix` then chooses the versions that match. If you would rather start from the newest Expo SDK, run `npx create-expo-app` in a scratch folder, then copy this app's `app/`, `src/`, `assets/`, `app.json` and `eas.json` over it and add the dependencies listed in `package.json`.

## 3. Build and run
The app uses native modules (secure storage, image picker, location), so use a development build, not Expo Go.
```
npm i -g eas-cli && eas login
eas build -p android --profile development     # installable APK, about 15 minutes the first time
npx expo start --dev-client                    # then open the installed app and scan the QR code
```
Or, with Android Studio installed: `npx expo run:android` builds and launches on an emulator or a USB-connected phone.

## 4. Try it
1. Welcome > Get started > enter your email > enter the emailed code.
2. Onboarding: birthday (must be 18+), basics, vibe, energy, interests, photos, preferences > Finish.
3. You land on the five-tab app. Profile > "Your vibes" pauses and adds vibes. Discover > the vibe chip switches vibes.

## 5. Trying discovery, likes and visitors
You need **two accounts** (two emails, or one on an emulator and one on a phone), each through onboarding in the same vibe with an **approved** photo. Then:
1. Account A: Discover shows B. Tap the card to open the profile, swipe right or tap the heart to like, up or the bolt to Spark, left or the X to pass, the circular arrow to rewind.
2. Account B: the heart icon on Discover shows a badge. Likes & Matches shows A (free and unblurred). Like back to see "It's a match!".
3. Visitors: open someone's profile and they appear in that person's Visitors tab. Turn on Profile > Browse incognito and they do not.
4. Profile > Edit profile: change your words per vibe, add prompts, choose which photos show in which vibe.
Other people's photos are served by the API, so the Railway API needs `SUPABASE_SERVICE_ROLE_KEY` set (server-side only).

## 6. Chat, invitations and the calendar
With two matched accounts (A and B):
1. A: Likes & Matches > Matches > the chat bubble (or the person's profile > Message). Send a message. B sees it appear live and the Chat tab shows an unread badge.
2. First-contact limit: A can send 3 messages until B replies; after one reply the limit is lifted. The app explains this kindly.
3. Photos in chat arrive hidden; B taps to view. B can report or block from the chat menu.
4. A: profile > Send an invitation (or the calendar icon in a chat). Pick how, when and how long, add a note.
5. B: Chat > Invitations shows it under "Needs your reply" with the four options: Accept, Suggest another time, Decline, Too new to say hi. Accepting puts it in both calendars (Calendar tab) and opens a chat.
6. After the time passes either person can Mark as done, then answer the private "How did it go?" questions.
"Add to my calendar" opens your phone's calendar app pre-filled; no calendar permission is needed.

### Open Calls and Activities
With three accounts (A host, B and C guests) in the same vibe:
1. A: Discover > Open Calls > Create an Open Call (pick an idea or write your own, a time, an area, how many people). It appears under Hosting and, for others in the same vibe who fit each other's preferences, under Browse.
2. B: tap Interested. A gets a notification (if push is set up) and sees B under Requests. A taps Accept or Decline. Accepting opens a group chat and puts the plan in both calendars. When all places are taken the call shows Full and newcomers can join the waitlist.
3. B can Withdraw; a place frees up. A declined person cannot re-apply (they just see "Not available").
4. A can Edit, Cancel (everyone is told) or Mark as done once it has started.
5. Discover > Activities: Host an activity (category, time, venue, limit). Anyone can see it and tap "I'm in". Going people see each other; when someone drops out the first person on the waitlist moves in.
6. In any chat, long-press someone else's message to report it.

### Push notifications (optional but recommended)
1. In Firebase, add an Android app with package `app.sidequest.android` (change it in `app.json` if you prefer another), download `google-services.json` into `apps/mobile/`, and add `"googleServicesFile": "./google-services.json"` under `expo.android` in `app.json`.
2. Rebuild the development app. In the app, Chat > "Turn on notifications".
3. On the Railway API set `FCM_SERVICE_ACCOUNT_JSON` and `WEBHOOK_SECRET` (16+ random characters), then in Supabase: Database > Webhooks > create a webhook on table `messages`, event **Insert**, HTTP POST to `https://YOUR-API/v1/hooks/message-created` with header `x-webhook-secret: <the same secret>`. Create a **second** webhook on table `notifications`, event **Insert**, to `https://YOUR-API/v1/hooks/notification-created` with the same header: this pushes Open Call requests, acceptances and activity changes written by the database. Invitation notifications and reminders need only `FCM_SERVICE_ACCOUNT_JSON` and the worker.
Without these, everything still works; people just do not get background notifications.

## 7. Photos in development
New photos wait for review (`pending`). To see them while testing, set `PHOTO_MODERATION=off` on the Railway API service. It logs a warning and auto-approves. Never use it in production.

## If something fails
Send me the exact error text and which step. Likely first-run issues: package versions (run `npx expo install --fix`), Metro not resolving the shared package (it is imported from `packages/shared/src`, written with `.ts` import suffixes), or a missing `.env` value.
