# Deploying the API and worker on Railway

Two Railway services from this one repository: **api** (HTTP) and **worker** (scheduled jobs). Supabase hosts the database, auth and storage.

## 1. Supabase
1. Create a project. In the SQL editor run, in order: `0001` to `0013` in `supabase/migrations`. (They have been run on a plain Postgres 16 with stand-ins for Supabase's own schemas, never on a hosted Supabase project; if one errors, send me the message.)
2. Run `supabase/tests/rls_smoke.sql`. It must end with `ALL RLS SMOKE TESTS PASSED`. Do NOT run `supabase/tests/local_stubs.sql` on Supabase: it is for local Postgres only.
3. Collect: **Project URL** (`SUPABASE_URL`) and the **database connection string** (Project settings > Database). The API connects as the database owner, so use the pooled "session" string and keep it secret.
4. Legacy projects only: copy the **JWT secret** to `SUPABASE_JWT_SECRET`. Newer projects publish public keys at `/auth/v1/.well-known/jwks.json` and need nothing.

## 2. Railway: api service
1. New Project > Deploy from GitHub repo (push this repository first).
2. Service settings: **Root directory** `/`, **Config as code path** `/apps/api/railway.json` (builds `apps/api/Dockerfile`).
3. Variables: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (needed to show other people's photos; server only), optional `SUPABASE_JWT_SECRET`, `FCM_SERVICE_ACCOUNT_JSON`, `WEBHOOK_SECRET` (for message notifications), `PHOTO_MODERATION` (`required` by default; `off` only for development). Railway sets `PORT` itself.
4. Networking > Generate domain. Check `https://<domain>/healthz` returns `{"ok":true}`.
5. Put that domain in the mobile app as `EXPO_PUBLIC_API_URL`.

## 3. Railway: worker service
1. In the same project add a second service from the same repo.
2. **Config as code path** `/apps/api/railway.worker.json` (same image, start command `node dist/worker.cjs`).
3. Same variables as the API. **`SUPABASE_SERVICE_ROLE_KEY` is required here** (the worker refuses to start without it): it writes data exports and deletes accounts through the Supabase Admin API. No public domain needed.
4. Run **exactly one** replica. Reminders and notifications are de-duplicated by the database, but one worker keeps the logs and load simple.

## 4. Push notifications (Firebase Cloud Messaging)
1. Firebase console > create a project > add an Android app with your package name.
2. Project settings > Service accounts > Generate new private key. Paste the whole JSON, on one line, into `FCM_SERVICE_ACCOUNT_JSON`.
3. Without it the API still works; users just get in-app notifications.

## 4b. Database webhooks (for background notifications)
Supabase > Database > Webhooks, two webhooks, both HTTP POST with header `x-webhook-secret: <WEBHOOK_SECRET>` and event **Insert**:
- table `messages` -> `https://YOUR-API/v1/hooks/message-created`
- table `notifications` -> `https://YOUR-API/v1/hooks/notification-created`
The API ignores anything that is not an insert, and ignores notifications it wrote itself (they are pushed when created).

## 5. Calls (optional, off by default)
In-app voice and video calls use **Daily** (daily.co). Set `FEATURE_VIDEO_CALLS=true`, `DAILY_API_KEY` and `DAILY_DOMAIN` (only the name before `.daily.co`).
1. Create a free Daily account, then copy the API key from the Developers page and note your domain name.
2. Put both values in Railway's variables. The key stays on the server; the phone only ever receives a token for one room.
3. The API makes a private room for each confirmed invitation (two people at most, closes itself when the call window ends) and issues a short-lived token
   only to the two people on that invitation, from 10 minutes before the start until 30 minutes after the planned end. Voice invitations start with the camera off.
4. With the flag off or a key missing, `POST /v1/invites/:id/call-token` returns `501 calls_not_configured` and the app shows "Calling is not switched on yet".
5. The app needs a **new development / production build** after this change (it adds Daily's native module and the microphone and camera permissions). A JavaScript-only update is not enough.
6. Cost: Daily's free allowance is about 10,000 participant-minutes a month (a 10-minute call between two people uses 20). Check daily.co/pricing for current terms and watch usage in the Daily dashboard.
7. Add Daily to your privacy policy's list of providers (done in the API's built-in page) and answer the camera/microphone questions in the Play Console Data Safety form.

## 6. Operating notes
- Logs are JSON lines. The API refuses to start and lists every missing variable.
- The per-user rate limiter is in memory. If you scale the API to several replicas, move it to Redis first.
- Never put `DATABASE_URL` or the service role key in the mobile app.
- After the first successful install, commit `pnpm-lock.yaml`.

## Moderation page
Set `SUPABASE_ANON_KEY` on the API service (and keep `SUPABASE_SERVICE_ROLE_KEY` set so moderators can view photos). Then open `https://<your-api>/admin`, enter a moderator's email and the one-time code Supabase emails. Give someone the role in the SQL editor: `insert into user_roles (user_id, role) values ('<their user id>', 'moderator') on conflict (user_id) do update set role = 'moderator';` (use `'admin'` for people who may ban). In Supabase, make sure email sign-in via one-time code is enabled and the email template includes the code (`{{ .Token }}`). The page keeps the sign-in token in memory only, so closing the tab signs you out. Opening a report's context is recorded in `moderator_audit`.

## Public pages (privacy policy, terms, web account deletion)
Set `LEGAL_NAME` (the person or company that runs the app), `CONTACT_EMAIL` and, if different, `CHILD_SAFETY_EMAIL` on the **api** service, plus `SUPABASE_ANON_KEY`. Then `https://<your-api>/privacy`, `/terms` and `/delete-account` go live (until both names are set they return 404, so a placeholder policy can never be published by accident). Google Play needs all three links. The texts are drafts written to match what the app does; have a lawyer or your local legal adviser read them before you launch.
