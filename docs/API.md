# Waypoint API (Railway) - v1

All routes except `/healthz` need `Authorization: Bearer <Supabase access token>`. Bodies are JSON. Errors: `{ "error": "code", "detail"?: "..." }`.
Everything that touches Likes, profiles, chat messages and photos goes directly to Supabase (row level security). This API owns the parts that need rules, rate limits or secrets.

| Method and path | Who | Notes |
|---|---|---|
| `POST /v1/invites` | sender | `{recipientId, modeId, format, startsAt (ISO with offset), timezone, durationMinutes 5-240, note?}` -> 201 |
| `GET /v1/invites?box=incoming\|outgoing\|all` | either | last 100 |
| `GET /v1/invites/:id` | either | 404 for outsiders |
| `POST /v1/invites/:id/accept` `/decline` `/too-new` | recipient | Too new opens nothing automatically |
| `POST /v1/invites/:id/cancel` | sender (pending) or either (confirmed) | |
| `POST /v1/invites/:id/reschedule` | the party who did not propose last | `{startsAt, durationMinutes, note?}` |
| `POST /v1/invites/:id/accept-reschedule` | the other party | updates both calendars |
| `POST /v1/invites/:id/light-chat` | recipient, after Too new | recipient decides when to say hi |
| `POST /v1/invites/:id/complete` | either, after start | triggers private safety prompt |
| `GET /v1/invites/:id/ics` | either | `text/calendar`; no email or phone included |
| `POST /v1/invites/:id/call-token` | either, in the call window | 501 unless calls are configured |

Error codes worth handling in the app: `needs_match` (403), `unavailable` (404, also used for blocks and hidden modes), `pending_exists` / `non_match_limit` / `daily_limit` / `rate_limited` (429), `invalid_transition` (409), `start_time_out_of_range` (400), `too_early` / `call_ended` (409).

| `POST /v1/photos/urls` | any signed-in person | `{items:[{userId, modeId, all?}]}` (max 30). Returns short-lived signed URLs for other people's approved photos that are visible to you in that vibe. Blocked, hidden and other-vibe photos come back empty. Own photos are signed on the device. |
| `POST /v1/photos/:id/submit` | photo owner | Runs moderation. Photos stay `pending` unless approved by a provider, a human, or the dev-only `PHOTO_MODERATION=off`. |
| `POST /v1/verification/age/start` | any | 501 `age_verification_not_configured` until a provider is plugged in. |
| `GET /v1/config` | any signed-in person | `{calls, photos, chatImages, exports}`: what this deployment has switched on. |
| `GET /admin` | nobody (static page) | The moderation page (needs `SUPABASE_ANON_KEY`, else 404). Nonce-based CSP, no inline handlers, text-only rendering. All data calls go from the browser straight to Supabase with the moderator's own token, so the database role checks decide everything. |
| `POST /v1/admin/photo-url` | moderators | `{photoId}` -> `{url}` (2-minute signed link). Only for photos waiting for review or with an open report. Everyone else, and every other failure, gets 404. |
| `GET /v1/data-requests/:id/download` | the person who requested the export | Returns `{url, expiresInSeconds: 300}`, a signed link to their finished export in the private `exports` bucket. 404 for anyone else's request, a deletion request, or a bad id; `409 not_ready` while it is still being built or after the file was removed (files last 7 days); 501 without the service role key. Requesting an export and deleting an account are database functions (`request_export`, `request_deletion`, `cancel_deletion`, `my_data_requests`) called by the app. |
| `POST /v1/chat-media/url` | member of the conversation | `{messageId}` -> short-lived URL for a chat image. The sender always can; the recipient only after tapping to reveal it. Blocked, deleted or non-member requests return 404. |
| `POST /v1/hooks/message-created` | Supabase database webhook | Authenticated by the `x-webhook-secret` header (not a user token). Sends a content-free push to the other member, at most one per conversation per minute. Disabled unless `WEBHOOK_SECRET` is set. |

Chat itself (sending, reading, realtime, read receipts) goes directly to Supabase under row level security; the API only handles what needs secrets or rules.
| `POST /v1/hooks/notification-created` | Supabase database webhook | Same secret as above. Pushes notifications written by database functions (`origin = 'db'`): Open Call requests and acceptances, activity changes. Content-free push text. |

Open Calls and Activities are written only through database functions (`create_open_call`, `express_interest`, `decide_participant`, `withdraw_interest`, `update_open_call`, `cancel_open_call`, `complete_open_call`, `create_activity`, `join_activity`, `leave_activity`, `cancel_activity`), called by the app with the person's own sign-in. Direct table writes are blocked by policy.

## Worker jobs (the `worker` service)
| Job | Every | What it does |
|---|---|---|
| expire_invites, reminders, expire_open_calls | 1 min | as before |
| roulette | 5 min | Groups waiting signups (same vibe, activity, time and area; blocks respected), then calls the SQL function `form_roulette_group`, which re-checks every signup. If anything changed the table is refused and nobody is notified. |
| checkin_prompts | 1 min | When a check-in time arrives: asks the person to confirm they are okay (one tap). Closes check-ins whose plan was cancelled, whose account is deleted, or that are more than 6 hours late (worker was down). |
| checkin_escalation | 1 min | 30 minutes after a prompt with no answer: marks it missed and notifies the trusted contact. Safety notifications ignore quiet hours. The push is name-free; the name is only inside the in-app notification. The person can still confirm they are safe afterwards and the contact is told. |
| lift_suspensions | 10 min | `select public.lift_expired_suspensions()` |
| data_exports | 1 min | Builds `export_user_data()` for each queued export, stores `<user id>/<request id>.json` in the private `exports` bucket, notifies `export_ready`. |
| account_deletions | 10 min | 7 days after a deletion request (and not cancelled): empties the person's folders in `profile-photos`, `chat-media`, `voice-intros` and `exports`, then deletes the login account through the Supabase Admin API; database cascades remove the rest. |
| purge_exports | 1 hour | Removes export files older than 7 days. |
Failed export/deletion requests retry after 5 minutes, up to 5 attempts, then stay `failed` with the error recorded and an `ALERT:` log line. A request stuck `processing` for 30 minutes (crashed worker) is taken over.
