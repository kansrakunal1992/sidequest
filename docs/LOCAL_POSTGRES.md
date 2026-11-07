# Running the database checks on a plain local Postgres

The authoring environment could install Postgres 16 and PostGIS, so migrations `0001`-`0013`, `rls_smoke.sql` and the `PgStore` integration test have been run for real. Supabase's own pieces (`auth.users`, `auth.uid()`, `storage`, the roles and default grants) are **stand-ins** in `supabase/tests/local_stubs.sql`, written from memory of how Supabase behaves. Passing here is strong evidence the SQL is valid and the rules hold; it is not proof about a hosted Supabase project.

```
# Ubuntu: sudo apt-get install postgresql postgresql-contrib postgresql-16-postgis-3
createdb sq
psql -v ON_ERROR_STOP=1 -d sq -f supabase/tests/local_stubs.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -d sq -f $f; done
psql -v ON_ERROR_STOP=1 -d sq -f supabase/tests/rls_smoke.sql        # ends with ALL RLS SMOKE TESTS PASSED, rolls back
cd apps/api && PG_TEST_URL=postgres://USER:PASSWORD@127.0.0.1:5432/sq node --test test/pg-integration.test.ts   # rolls back
```
`local_stubs.sql` assumes the database is called `sq` (it sets that database's search_path). Never run it on Supabase.
