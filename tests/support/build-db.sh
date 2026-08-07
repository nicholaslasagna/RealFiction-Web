#!/usr/bin/env bash
# Builds a disposable PostgreSQL database from the real migration files, with a
# Supabase-shaped shim. Used by route-level tests that need real SQL.
set -euo pipefail
PGBIN=${RF_PGBIN:-/opt/homebrew/opt/postgresql@16/bin}
SOCK=${RF_PGSOCKET:-/tmp/rfpg}
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DB=${1:?database name}
export LC_ALL=C
psql_() { "$PGBIN/psql" -h "$SOCK" -U postgres -v ON_ERROR_STOP=1 "$@"; }

psql_ -d postgres -q -c "drop database if exists $DB" -c "create database $DB"
psql_ -d "$DB" -q <<'SHIM'
create schema if not exists extensions;
create schema if not exists auth;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
grant usage on schema public, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table if not exists auth.users (
  id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable
  as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
create or replace function auth.role() returns text language sql stable
  as $f$ select nullif(current_setting('request.jwt.claim.role', true), '')::text $f$;
SHIM
psql_ -d postgres -q -c "alter database $DB set search_path = public, extensions"
for f in "$REPO"/supabase/migrations/*.sql; do psql_ -d "$DB" -q -f "$f" >/dev/null; done
