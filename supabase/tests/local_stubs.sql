-- TEST-ONLY stand-ins for the parts of Supabase that exist on a hosted project but not on plain Postgres.
-- Never run this on a real Supabase project. Use it on an empty local database BEFORE migrations 0001-0011:
--   createdb sq && psql -v ON_ERROR_STOP=1 -d sq -f supabase/tests/local_stubs.sql && for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -d sq -f $f; done
-- These mimic Supabase from memory (auth.uid reading the request.jwt.claim.sub setting, default grants, storage.foldername). They are NOT Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth; create schema extensions; create schema storage;
create extension if not exists pgcrypto with schema extensions;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql as $$ declare p text[]; begin p := string_to_array(name, '/'); return p[1:array_length(p, 1) - 1]; end $$;
create publication supabase_realtime;
grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), storage.foldername(text) to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role; grant select on storage.buckets to authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter database sq set search_path = public, extensions;
