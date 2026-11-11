# v16 changes (on top of v15): Let's Meet and Date Ideas

Honest status: written and tested on a **local Postgres 16 with PostGIS** (stand-ins for Supabase), with the unit and screen tests.
**Not run on a phone, a hosted Supabase project, Railway or real push delivery.**

Ran here: shared 61/61, API 141 passed (9 skipped without a database), API against real Postgres 9/9, mobile 161 passed,
RLS smoke test passed, SQL checker clean (63 tables, 82 policies), type-checks clean for all three packages.
Known flake: one mobile screen test (the Wingperson one, a tap that can race the screen loading) failed in a few of roughly 15 full runs on the
single-CPU sandbox (I identified it by name in two of them) and passes when re-run. It was already flaky before these changes.

## What you can do now
- **Meet in person** is an invitation option. Pick an activity (13 to choose from), a named public place, the neighbourhood, a time and a note.
  The other person can accept, suggest another time, decline, or say it is too new, exactly as before.
- Rules: in-person plans need a **match** in that vibe, at least **one hour** of notice, and no phone numbers, links or handles in the place or note.
  No exact address is collected.
- The plan screen shows the place, first-meeting tips before you say yes, and once confirmed a **Share my plan** button (the phone's share sheet;
  first name, activity, place and time only) and a link to set a **safety check-in**.
- The calendar entry and the `.ics` file are named after the activity ("A walk with Aman") and carry the place.
- A **day-before reminder** goes to both people for in-person plans, once. Plans confirmed with less than 10 hours to go skip it. Calls are unchanged.
- **Chat nudge**: after a real back and forth (at least 2 messages from each of you, 6 in all), or when a chat of 4 or more messages has been quiet for a day,
  a "Make a plan" card appears above the message box. It hides when a plan is already open and when dismissed (dismissal lasts for that visit). Nothing is sent by it.
- **Date Ideas**: up to three activities and a usually-free window (weekday evenings, weekends, flexible) in Edit profile.
  They show on swipe cards ("Up for: ..."), and on a profile, where matched people can tap one to open a plan with it chosen and see "You both like".

## Files
- Database: `0018_lets_meet.sql` (in-person format, plan columns with a check that a plan has a place, `date_ideas` table, `set_date_ideas`, `my_date_ideas`,
  `date_ideas_for`, data export updated), `rls_smoke.sql` additions, `check-sql.mjs` (the new table is function-only).
- Shared: `meet.ts` (activities, windows, place rules, tips, share text), new notification kind `invite_day_before`.
- API: invite types, validation, service (match and lead-time rules, titles, location in `.ics`), store, DTO, reminder job, push wording.
- App: invite composer, plan screen, chat nudge, Date Ideas editor / profile card / swipe card line, database wrappers, wording for new errors.
- Tests: shared `meet.test.ts`, API `lets-meet.test.ts` and one real-database test, mobile `lets-meet-core.test.ts` and 8 new screen tests.

## Run order after applying these files
1. Run `supabase/migrations/0018_lets_meet.sql` (after 0017). It adds an enum value; nothing in the file uses that value, so it is safe in one transaction.
2. Redeploy the API. 3. Rebuild the app. Until step 1 is done the app still works: Date Ideas simply do not appear, and creating an in-person plan fails.

## Decisions to know about
- In-person plans need a match. Adventures-style intros without a match use Open Calls instead.
- Rescheduling changes the time only. To change the place, cancel and make a new plan.
- The chat nudge is on the phone, not a server push, so it only appears while the chat is open.
- Date Ideas are low-sensitivity profile content shown under the same rules as a profile: same vibe, not blocked, account active.
  Unmatched people see them but cannot tap through to a plan.
- Check-in alerts reach a trusted contact only if they use Waypoint (unchanged; there is still no SMS or e-mail path).

## Not done (planned in steps 3 and 4)
- Intent chips inside each vibe, "who can invite me" controls, visible trust levels, image scanning, reaching contacts who are not on the app,
  and flake handling are not built. Recurring Open Calls and "bring friends" are also still open.
- Date Ideas are not shown in the grid view, only on cards and profiles.
