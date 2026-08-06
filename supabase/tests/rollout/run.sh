#!/usr/bin/env bash
# Builds everything the rollout harness needs, then runs it.
#
#   supabase/tests/rollout/run.sh
#
# Creates two disposable databases (all migrations / migrations as of the
# pre-store commit) and a git worktree of the pre-store application, runs the
# three application-versus-schema combinations, and cleans up the worktree.
#
# Requires a local PostgreSQL 16 with pgcrypto and a Supabase-shaped shim.
# Docker is unavailable on the development host, so this drives a plain local
# server over a unix socket rather than `supabase start`.
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
PGBIN=${RF_PGBIN:-/opt/homebrew/opt/postgresql@16/bin}
SOCKET=${RF_PGSOCKET:-/tmp/rfpg}
NEW_DB=${RF_NEW_DB:-rollout_new}
OLD_DB=${RF_OLD_DB:-rollout_old}
WORKTREE=${RF_WORKTREE:-${TMPDIR:-/tmp}/rf-rollout-oldapp}

# The last migration that existed before the store redesign began. Everything
# after it is what the rollout is testing.
PRE_STORE_MIGRATION=${RF_PRE_STORE_MIGRATION:-202607220001_transactional_email_outbox.sql}
PRE_STORE_COMMIT=${RF_PRE_STORE_COMMIT:-59ae7fb}

export LC_ALL=C
psql_() { "$PGBIN/psql" -h "$SOCKET" -U postgres -v ON_ERROR_STOP=1 "$@"; }

build_db() {
  local db=$1 cutoff=$2 applied=0
  psql_ -d postgres -q -c "drop database if exists $db" -c "create database $db"

  psql_ -d "$db" -q <<'SHIM'
create schema if not exists extensions;
create schema if not exists auth;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
grant usage on schema public, extensions to anon, authenticated, service_role;
-- Supabase grants by default and relies on migrations to revoke; without this
-- the shim is stricter than production.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table if not exists auth.users (
  id uuid primary key, email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable
  as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
create or replace function auth.role() returns text language sql stable
  as $f$ select nullif(current_setting('request.jwt.claim.role', true), '')::text $f$;
SHIM

  psql_ -d postgres -q -c "alter database $db set search_path = public, extensions"

  for file in "$REPO"/supabase/migrations/*.sql; do
    [[ "$(basename "$file")" > "$cutoff" ]] && continue
    psql_ -d "$db" -q -f "$file" >/dev/null
    applied=$((applied + 1))
  done
  echo "  $db: $applied migrations (cutoff $cutoff)"
}

echo "Building disposable databases"
build_db "$NEW_DB" "zzzz"
build_db "$OLD_DB" "$PRE_STORE_MIGRATION"

echo "Checking out the pre-store application at $PRE_STORE_COMMIT"
git -C "$REPO" worktree remove --force "$WORKTREE" 2>/dev/null || true
git -C "$REPO" worktree add --detach --quiet "$WORKTREE" "$PRE_STORE_COMMIT"
# The harness exercises old APPLICATION CODE, not old dependency versions, so the
# worktree shares the current install rather than reinstalling a second copy.
ln -sfn "$REPO/node_modules" "$WORKTREE/node_modules"

echo
node "$REPO/supabase/tests/rollout/harness.mjs" "$NEW_DB" "$OLD_DB" "$WORKTREE" 2>/dev/null
status=$?

git -C "$REPO" worktree remove --force "$WORKTREE" 2>/dev/null || true
exit $status
