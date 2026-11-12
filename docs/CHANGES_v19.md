# v19: profile, verification, calls, calendar picker, seeding

Merged on top of v16 (Let's Meet / Date Ideas). Migrations: `0018_lets_meet.sql` is yours; mine is **`0019_verified_badge_sync.sql`** (run it after 0018).

## 1. Photo verification
- **Bug fixed (0019):** a passed selfie set `profiles.verified_at`, but every card, profile view, match, like and chat list reads `verification_status.identity_verified`, which nothing ever set, so the badge never appeared.
  A trigger now keeps them in step and existing verified people are back-filled. Proven in `supabase/tests/verified_badge_smoke.sql` (reproduces the bug with the trigger off, then the fix).
- Verify screen shows your main photo, the three steps, and "photo still in review" / "add a photo" before you tap start (previously it failed after the tap).
- Verification stays **optional but prominent**: onboarding tip, Profile header, "Finish your profile" checklist, and one dismissible Discover banner (comes back after 7 days if still undone).
- You can now **make any photo your main photo** (it is the one the selfie is compared with).

## 2. Own profile and photos
- New **How others see you** screen (`/my-profile`): per-vibe preview, photos that others cannot see are shown dimmed with the reason ("In review", "Hidden in this vibe").
- Profile tab header (photo, name, verified state, preview and edit buttons).
- Add photos: feedback now appears inside the Photos card (it used to appear at the top of a long scroll), real error reasons, an "Add photos" tile, and new photos are positioned **after** existing ones
  (before, every batch started at position 0 and could silently replace the main photo). Not confirmed on a real phone.

## 3. Invitations
- "Send an invitation" is hidden where it cannot work (Explore) with a plain explanation; error wording is clearer. Pre-match invitations remain allowed in the other five vibes; in-person plans still need a match (v16).

## 6. In-app calls (Daily)
- API: `apps/api/src/daily.ts` (private two-person room per invitation that closes with the call window; short-lived one-person token). `FEATURE_VIDEO_CALLS=true` + `DAILY_API_KEY` + `DAILY_DOMAIN`. LiveKit removed.
- App: `/call/[id]` (pre-join page, mute / camera / flip / end / Report, auto-end at window close), Join card on the invitation page, microphone and camera permissions asked only when you tap Join.
- Needs a **new native build** (Daily SDK + permissions). Pinned to the Expo 54 compatible set: `react-native-daily-js 0.82.0`, `react-native-webrtc 124.0.6-daily.1`, `config-plugin 0.0.11`.
  Daily's package asks for async-storage `^1.24` and Expo 54 bundles 2.2.0 (same basic API); watch for this on the first build.
- Tested with a fake Daily server and a fake call object. **Never run against real Daily or on a real phone.**

## 7. Calendar picker
- Shared `TimePicker` now opens the phone's own calendar and clock (one fix for all 7 scheduling screens). Next 90 days only, 7:00 pm pre-filled after choosing a date, quick choices kept. Needs a new native build (`@react-native-community/datetimepicker 8.4.4`).

## 5. Seeding
- `scripts/seed/` and `docs/SEEDING.md`: 36 states and UTs x 50 profiles, region-appropriate names, bios, vibes, prompts, Date Ideas, locations near each city, purge script, safety guard against seeding a database that has real users.

## Tests
shared 61, API 153 (including 9 real-database tests), mobile 139 core + 52 screen, seed generator 8, SQL smoke tests (RLS + badge), SQL static checks. Release-config test updated deliberately: the microphone and camera are now allowed.

## Known gaps
Real-phone test of calls and add-photos; real Daily account; real Supabase Storage upload of seed photos; photorealistic seed images (supply your own); "call from chat" (calls stay tied to scheduled invitations).
