# Safety ledger (working notes for the final trust-and-quality design)

You asked for a dedicated design at 100% on keeping Waypoint high quality, so people who want quality get quality and bad actors cannot ruin it. This is the running inventory of what already exists, so the final design builds on it instead of repeating it.

## Already built, and where
| Safeguard | Where |
|---|---|
| 18+ enforced by the database, not just the app | `0001` trigger, `save_onboarding` |
| Exact location never stored (snapped to ~1 km on the server) | `0005` |
| Only people who opted into the same vibe can see each other; activity never leaks across vibes | `0003`, `0006` |
| Clients cannot change account state, date of birth, photo approval, membership or permissions | `0005` column grants |
| Photos stay hidden until approved (fail closed); EXIF/location stripped on the phone | API `photos.ts`, app `photos.ts` |
| Block (silent) and report on every profile and chat | app `SafetyMenu` |
| Blocked, hidden and other-vibe people look identical to "unavailable" (no probing) | API, `0003`, `0006` |
| First contact limited to 3 messages until the other person replies; 30 messages a minute | `0007` guard |
| Invitations: one open invite per pair, daily limits, recipient can say "too new" or decline with no reason | shared rules, API |
| Chat photos hidden until the recipient chooses to view; report/block one tap away | `0007`, API `chat.ts` |
| Read receipts optional and truly private | `0007` |
| Names cannot contain contact details; invitation notes discourage them | app `onboarding.ts` |
| Private post-meeting safety questions (never shown to the other person, not a rating) | `0002`, app `PostMeetSheet` |
| Push text never reveals names, vibes or intent | API tests |
| Rewind cannot undo a match; likes and visitors are free and unblurred | `0006` |
| Open Calls: only same-vibe people who fit each other's preferences can see them; the host decides who joins; a declined person cannot re-apply and just sees "Not available" | `0008` |
| Open Calls and Activities cannot be created or changed by writing to tables directly; no exact locations; 5 active plans per person; 20 requests a day | `0008` |
| Blocked people's messages are hidden even in group chats; blocked people cannot join your plans | `0008` |
| Report a single message, an Open Call, or an activity | app, `reports` |
| Activity attendee lists are visible only to people who are going; waitlisted people cannot see them | `0008` |

## Written in the database, not yet wired into the app or tested on a real database (migrations 0009 and 0010)
- Friend codes (rate-limited lookups) for wingperson, team, trusted-contact and couple invitations; no permission for chats exists for wingpersons.
- Wingperson suggestions apply only to the owner's own profile text; accepted by the owner, never auto-applied.
- Double dates need two accepted pairs, no blocks between any members, mutual preferences in romantic vibes.
- Roulette: host must name a public venue; people can leave a table at any time.
- Circle membership: private circles are invite-only; removed members cannot rejoin.
- Chemistry games: answers are hidden until you have answered that round yourself.
- Moderators act only through role-checked functions; ban and restore need an admin; mass reporting only raises queue priority, never acts by itself.
- Ban-evasion check: hashes of banned emails block re-registration.
- Account deletion hides at once and purges after 7 days (cancellable); data export on request.
- Trusted contacts and meeting check-ins: prompt and 30-minute escalation jobs are built and tested (in-memory and on a local Postgres); the app screens are not.

## Holes found and closed while running the SQL for the first time (migration 0011 and fixes)
- `data_requests`, `trusted_contacts` and `meeting_checkins` still had direct-write client policies after 0010 added functions for them. A client could forge a finished export pointing at someone else's file, add any user as a "trusted contact" without a friend code (so a missed check-in would push to a stranger), or rewrite check-ins. Now function-only, the checker fails if a policy returns, and an export path must sit in its owner's folder (database constraint plus an API check).
- `form_roulette_group` could seat a cancelled, blocked, paused or suspended person if they changed state between the matcher reading and the table being formed. It now re-validates and refuses.
- A moderator's own account could not be deleted (foreign key). Fixed; their decisions stay with the name detached.

## Added in v10
- Moderators see the minimum: `mod_report_context` returns the reported message plus up to three either side, labelled only "reported" / "other" (the other person's name is not shown). Opening a report is written to `moderator_audit`, as are photo approvals and rejections. Moderators have no raw table access.
- Pending photos now have a human review queue (`mod_photo_queue`, `mod_review_photo`); the API signs a 2-minute photo link only for moderators and only for photos waiting for review or with an open report.
- Blocked list (`my_blocks`) shows names to the blocker only. Together: the invited partner can finally agree, each person changes only their own side, and withdrawing switches all their sharing off (`set_couple_consent`).
- The inbox and push copy never contain names, vibes or message text; a test feeds hostile payloads through every kind.

## Known gaps for the final design discussion
- Private circles cannot be joined by anyone (there is no function to invite into one), so the app refuses to create them.
- The moderation page's sign-in relies on Supabase email codes for moderator accounts; there is no second factor and no per-moderator rate limit beyond Supabase's own.
- A person under a suspension can request deletion, be deleted after 7 days, and register again with the same email: only bans are remembered (`banned_identifiers`). Reports about a deleted person lose their link to the person (`reported_user_id` becomes null), so evidence does not follow them.
- Deletion removes the messages a person sent from other people's chats (cascade). Safe for privacy, but it also erases evidence of harassment that was never reported.
- Roulette areas are free text ("Soho" vs "Soho, London" are different places). A real place picker is needed before this scales.
- Check-in escalation notifies another Waypoint member only; there is no SMS or email path for a contact who does not use the app.

## Not built yet (feeds the final design)
- Moderation console, report triage and automatic escalation; repeat-offender detection.
- Image scanning provider; text/link scanning for scams and solicitation.
- Identity and liveness verification provider; "verified" tiers.
- Trusted-contact check-ins and meeting safety flows.
- Trust signals from the private post-meeting answers and report history.
- Sorting by explicit intent and consent (what people say they want, and what they have agreed to see) versus removing non-consensual behaviour.
- Appeals, strikes and sanctions; account deletion and data export.

## Principle to keep
Sort by consent, remove by conduct. People who want different things should find different people because they chose different vibes, not because someone guessed their character. People who ignore consent should be removed, not routed to others.


## Let's Meet and Date Ideas (v16)
- In-person plans are offered only between people who have matched in that vibe, need at least an hour of notice, and name a place and an area.
  Contact details are refused in the place and the note, on the phone, in the API and (length only) in the database.
- No exact address is stored. The place is what the sender typed, shown only to the two people in the plan, and included in their own calendar file.
- Share my plan uses the phone's share sheet: first name, activity, place and time. No phone number, photo or account detail is included. What the person
  sends, and to whom, is up to them.
- A safety check-in is optional. If it is set and goes unanswered for 30 minutes, the trusted contact is told, but only if that contact uses Waypoint.
- Date Ideas are written only through a checked function and read only under the profile rules (same vibe, not blocked, active). They are in the data export,
  and are deleted with the account.
- Not covered yet: there is no check that a named place is public, no image scanning, and nothing reaches a contact who is not on the app.
