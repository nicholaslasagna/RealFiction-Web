# Deferred migrations

Migrations here are **written and reviewed but deliberately not applied**.

They live outside `supabase/migrations/` because the Supabase CLI applies every
unapplied file in that directory, in lexical filename order, whenever
`supabase db push` runs. A deferred migration left there is one routine push
away from being applied by accident — and `202608100003` sorts *before*
`202608110001`, so a push intended to ship the newer one would have applied the
deferred one first.

Moving the file is the only protection that does not depend on somebody
remembering. Nothing is faked: the migration is unapplied locally and remotely,
and the two stay consistent.

## To apply one

Move it back and push, or run it in the SQL editor and record it:

```bash
git mv supabase/deferred/<file> supabase/migrations/<file>
```

## Current contents

| Migration | Why deferred |
|---|---|
| `202608100003_profile_role_history.sql` | Forensic role-change history. Purely additive, but not needed for the security rollout, and every additional DDL in a rollout is additional risk. Apply when convenient, on its own. |
