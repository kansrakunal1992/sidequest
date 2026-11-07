# SideQuest

People, plans, possibilities. 100% free, forever. Android first, iOS later.

## Layout
- `packages/shared` - pure TypeScript rules shared by app, API and admin (tested).
- `supabase/migrations` - Postgres schema, RLS and RPCs (apply in numeric order).
- `supabase/tests/rls_smoke.sql` - security smoke tests to run on a real database.
- `scripts/check-sql.mjs` - static SQL safety checks.
- `apps/api` - Railway API and worker (invites, calendar/ICS, push, calls, jobs). `apps/mobile` - Android app (Expo). The moderation page is served by the API at `/admin`.
- `docs/PROGRESS.md` - milestone tracker and security model. `docs/API.md` - endpoints. `docs/DEPLOY_RAILWAY.md` - go-live steps. `docs/ANDROID_RUN.md` - run the app on a phone.

**Starting from nothing? Follow `docs/START_TO_FINISH_GUIDE.md`: it takes you step by step from downloading the zip to Google Play.**

## Verify
```
cd packages/shared && node --test test/*.test.ts && npx tsc -p tsconfig.json
node scripts/check-sql.mjs
# with internet: pnpm install, then in apps/api: node --test test/*.test.ts
```

## Database setup
1. Create a Supabase project.
2. In the SQL editor run `0001` to `0013` in `supabase/migrations` in order.
3. Run `supabase/tests/rls_smoke.sql`. It should end with `ALL RLS SMOKE TESTS PASSED` (everything rolls back).
4. Copy `.env.example` to `.env` and fill in values. Never commit `.env`, and never ship the service-role key in the mobile app.
