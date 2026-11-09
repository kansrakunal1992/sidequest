# Sandbox helpers (for whoever continues this project in a Linux sandbox with apt + npm)

These are the scripts used to verify the SQL on a real Postgres. They are NOT needed on your own computer or on Supabase.

1. `install-postgres.sh`   apt-installs Postgres 16 + PostGIS (needs root and network).
2. `rebuild-db.sh`         drops and recreates database `sq`, applies `supabase/tests/local_stubs.sql` then every migration in order. Prints `ALL MIGRATIONS APPLIED` or the first error.
3. `smoke.sh`              rebuild + run `supabase/tests/rls_smoke.sql`; prints nothing when everything passes (add `-v` to see the final PASSED line).
4. The Postgres process is killed between some tool calls in the sandbox: `ensure-pg.sh` restarts it (all scripts call it first).

API integration tests: `cd apps/api && PG_TEST_URL=postgres://postgres:pgtest@127.0.0.1:5432/sq node --test test/pg-integration.test.ts`
(set the postgres password once: `runuser -u postgres -- psql -d sq -c "alter user postgres password 'pgtest'"`).
Everything else: `corepack enable && pnpm install && pnpm test && pnpm typecheck && pnpm check:sql` (tested from a fresh unzip).
