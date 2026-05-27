# Economy database readiness (Phase 17)

Precise **read-only** checklist and verification SQL before any SMP **live**
`shop_sell` ledger trial. This phase documents and verifies only — it does **not**
apply migrations, change production policy, deploy, or enable live gameplay writes.

**Related:**

- [ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md](./ECONOMY_SMP_DRY_RUN_VALIDATION_RESULTS.md) — Phase 16 SMP jar/config dry-run
- [ECONOMY_GAMEPLAY_PREFLIGHT.md](./ECONOMY_GAMEPLAY_PREFLIGHT.md) — plugin preflight (read-only API probe)
- [ECONOMY_TRANSACTION_CATEGORIES.md](./ECONOMY_TRANSACTION_CATEGORIES.md) — category ↔ policy mapping
- [ECONOMY_SMP_READONLY_POLICY_ROLLOUT.md](./ECONOMY_SMP_READONLY_POLICY_ROLLOUT.md) — Phase 5 SMP read-only policy
- [ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md](./ECONOMY_SMP_GAMEPLAY_WRITE_POLICY_ROLLOUT.md) — future live policy (Phase 7+)

---

## Phase 17 operator rules

| Rule | Detail |
|------|--------|
| **Do not** run `supabase db push` against production without staff review | |
| **Do not** run live-trial policy `UPDATE` in this phase | Marked **DO NOT RUN** below |
| **Do not** submit plugin economy transactions during verification | Balance read only |
| **Lobby1** `vote_reward` must stay live (`can_reward=true`) | |
| **SMP** stays `can_earn=false` until a later approved phase | |

Record verification date, operator, and Supabase project ref in your run log.

---

## 1. Migration inventory

All paths are under `supabase/migrations/`. Check what is **already applied** in
production before assuming repo files are live.

### How to check applied migrations (read-only)

```sql
-- Supabase-hosted projects (typical)
select version, name
from supabase_migrations.schema_migrations
where version >= '202605240018'
order by version;

-- If the schema_migrations table is unavailable, verify by object presence instead
-- (sections below).
```

### Economy migration table

| Order | Migration file | Required before live SMP `shop_sell`? | Purpose |
|------:|----------------|----------------------------------------|---------|
| 1 | `202605240018_global_economy_foundation.sql` | **Yes** | `economy_server_policies`, `economy_balances`, `economy_ledger`, RPCs (`get_plugin_economy_balance`, `apply_economy_transaction`, `apply_economy_batch`), default policy seeds |
| 2 | `202605240019_apply_economy_batch_ambiguity_fix.sql` | **Yes** | Fixes `apply_economy_batch` ambiguity from 018 |
| 3 | `202605240020_economy_migration_import.sql` | **If balances imported** | `admin_import_economy_balances` / migration import path |
| 4 | `202605240021_admin_import_economy_balances_ambiguity_fix.sql` | **If 020 applied** | Import RPC fix |
| 5 | `202605240022_admin_rollback_economy_import_ambiguity_fix.sql` | **If import rollback used** | Rollback import RPC fix |
| 6 | `202605250023_public_economy_leaderboard.sql` | **Optional** | `public_economy_leaderboard` for website; **not** required for plugin writes |
| 7 | `202605250024_smp_readonly_economy_policy.sql` | **Yes** | `smp-1` read-only policy (`can_read=true`, writes false, caps 0) |
| 8 | `202605270026_economy_transaction_categories.sql` | **Yes** | `shop_sell`, `shop_buy`, `gameplay_spend`, `vault_mirror_adjustment`; policy mapping updates |

### Not economy migrations (do not confuse)

These are network/platform migrations and are **not** substitutes for 018/026:

- `202605220015_playtime_tracking.sql`
- `202605220016_network_stats_foundation.sql`
- `202605230017_network_stat_events.sql`
- `202605200003_realcore_delivery.sql` (rewards delivery — separate from economy ledger)

### Minimum set for live SMP `shop_sell` (earn-only trial)

Apply (or confirm already applied) **at least**:

1. `202605240018` — foundation  
2. `202605240019` — batch fix  
3. `202605250024` — SMP read-only policy row  
4. `202605270026` — category + `_economy_assert_policy` for `shop_sell` → `can_earn`  

Plus import migrations **020–022** if production balances came from admin import.

### Object-presence sanity check (if migration history unclear)

```sql
select to_regclass('public.economy_server_policies') as policies,
       to_regclass('public.economy_balances') as balances,
       to_regclass('public.economy_ledger') as ledger,
       to_regproc('public.get_plugin_economy_balance') as balance_rpc,
       to_regproc('public.apply_economy_batch') as batch_rpc;
```

All five should be non-null before live writes.

---

## 2. Verification SQL

Run in the **Supabase SQL Editor** (read-only `SELECT` unless noted). No
`apply_economy_*` calls with real amounts in Phase 17.

### A. Category constraint supports required values

**Expected after `202605270026`:** `economy_ledger_category_allowed` includes:

| Category | Plugin route | Notes |
|----------|--------------|-------|
| `vote_reward` | Yes | Lobby1 live |
| `gameplay_earn` | Yes | |
| `gameplay_spend` | Yes | |
| `shop_sell` | Yes | SMP live trial target |
| `shop_buy` | Yes | |
| `spend` | Yes | Legacy alias |
| `admin_adjustment` | No | Admin RPC only |
| `migration_import` | No | Import RPC only |
| `vault_mirror_adjustment` | No | Ledger-reserved; not plugin batch |

```sql
-- Inspect CHECK constraint definition on economy_ledger.category
select pg_get_constraintdef(c.oid) as constraint_def
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname = 'economy_ledger'
  and c.conname = 'economy_ledger_category_allowed';
```

**Pass:** definition lists all categories above (especially `shop_sell`, `shop_buy`, `gameplay_spend`, `vault_mirror_adjustment`).

```sql
-- Optional: list distinct categories already stored (read-only)
select category, count(*) as row_count
from public.economy_ledger
group by category
order by category;
```

### B. Plugin transaction API policy mapping

Authoritative mapping (from `_economy_assert_policy` in migration **026**):

| Category | Policy flag required |
|----------|----------------------|
| `vote_reward` | `can_reward` |
| `gameplay_earn` | `can_earn` |
| `shop_sell` | `can_earn` |
| `gameplay_spend` | `can_spend` |
| `shop_buy` | `can_spend` |
| `spend` | `can_spend` |

Categories **not** allowed through plugin policy checks:
`admin_adjustment`, `migration_import`, `vault_mirror_adjustment`.

```sql
-- Confirm policy helper functions exist (026+)
select proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in ('_economy_assert_policy', '_economy_assert_plugin_category')
order by proname;
```

**Pass:** both functions exist. Do **not** call `apply_economy_transaction` with live amounts in Phase 17.

### C. `economy_server_policies` expected state (before live trial)

```sql
select
  server_id,
  server_group,
  enabled,
  can_read,
  can_reward,
  can_earn,
  can_spend,
  max_credit_minor,
  max_debit_minor,
  max_batch_count,
  notes,
  updated_at
from public.economy_server_policies
where server_id in ('lobby-1', 'smp-1', 'anarchy-1', 'factions-1', 'arcade-1')
order by server_id;
```

| server_id | Expected before live SMP `shop_sell` trial |
|-----------|------------------------------------------|
| **lobby-1** | `enabled=true`, `can_reward=true` (live vote path). `can_earn`/`can_spend` typically false unless separate rollout. Credit/batch caps support vote.standard (e.g. `max_credit_minor >= 25000`, `max_batch_count >= 1`). |
| **smp-1** | `enabled=true`, `can_read=true`, **`can_earn=false`**, **`can_spend=false`**, **`can_reward=false`**, all caps **`0`**, `max_batch_count=0` (Phase 5 read-only). |
| **anarchy-1** | **`enabled=false`**, all capability flags **false**, caps **0**. |
| **factions-1** | **`enabled=false`** (unless separate approved rollout). |
| **arcade-1** | **`enabled=false`** (unless separate approved rollout). |

```sql
-- Hard stop: SMP must not already have earn enabled before Phase 17 sign-off
select server_id, can_earn, can_spend, can_reward
from public.economy_server_policies
where server_id = 'smp-1'
  and (can_earn = true or can_spend = true or can_reward = true);
```

**Pass:** zero rows.

```sql
-- Hard stop: Lobby must still allow vote rewards
select server_id, enabled, can_reward
from public.economy_server_policies
where server_id = 'lobby-1'
  and (not enabled or not can_reward);
```

**Pass:** zero rows.

### D. `economy_balances` exists and top balances look reasonable

```sql
select count(*) as balance_rows
from public.economy_balances
where currency_key = 'realfiction_main';

select
  minecraft_username,
  minecraft_uuid,
  balance_minor,
  updated_at
from public.economy_balances
where currency_key = 'realfiction_main'
  and balance_minor > 0
order by balance_minor desc
limit 25;
```

**Pass:** table exists; row count matches expectations after import; top balances are plausible (no obvious corruption). Compare to a known export if available (`docs/ECONOMY_BALANCE_AUDIT.md`).

### E. `economy_ledger` and recent `vote_reward` rows

```sql
select count(*) as ledger_rows
from public.economy_ledger;

select
  id,
  category,
  amount_minor,
  source_server_id,
  idempotency_key,
  created_at
from public.economy_ledger
where category = 'vote_reward'
order by created_at desc
limit 20;
```

**Pass:** ledger exists; recent `vote_reward` rows show `source_server_id = 'lobby-1'` (or expected Lobby id), positive credits, familiar idempotency prefix `reward:`, timestamps consistent with live voting.

```sql
-- Lobby vote volume sanity (last 24h) — adjust interval as needed
select count(*) as vote_reward_last_24h
from public.economy_ledger
where category = 'vote_reward'
  and source_server_id = 'lobby-1'
  and created_at > now() - interval '24 hours';
```

### F. No unexpected gameplay / shop_sell rows

```sql
select category, count(*) as row_count
from public.economy_ledger
where category in (
  'shop_sell',
  'shop_buy',
  'gameplay_earn',
  'gameplay_spend',
  'spend'
)
group by category
order by category;
```

**Pass before live trial:** counts are **zero**, or unchanged since Phase 16 dry-run baseline. Any new `shop_sell` rows after dry-run without an approved live trial → **stop** and investigate.

```sql
select *
from public.economy_ledger
where category in ('shop_sell', 'shop_buy', 'gameplay_earn', 'gameplay_spend', 'spend')
order by created_at desc
limit 20;
```

---

## 3. Safe dry-run SQL (Phase 16)

Use **before** and **after** SMP EconomyShopGUI dry-run (plugin `dryRun=true`, DB
policy still read-only). Counts must **not** increase.

```sql
-- BEFORE dry-run test
select count(*) as shop_sell_count_before
from public.economy_ledger
where category = 'shop_sell';

-- AFTER dry-run test (same query)
select count(*) as shop_sell_count_after
from public.economy_ledger
where category = 'shop_sell';
```

**Expected:** `shop_sell_count_before = shop_sell_count_after`.

```sql
-- Broader gameplay categories (should not gain rows from dry-run)
select category, count(*) as row_count
from public.economy_ledger
where category in ('shop_sell', 'shop_buy', 'gameplay_earn', 'gameplay_spend', 'spend')
group by category;
```

---

## 4. Live trial readiness SQL — DO NOT RUN DURING PHASE 17

> **DO NOT RUN DURING PHASE 17.**  
> For a **future** SMP earn-only `shop_sell` trial (after Phase 16 dry-run pass,
> plugin preflight live READY, and staff approval). This enables **`can_earn` only**
> — not `can_spend`, not `can_reward`.

```sql
-- ═══ DO NOT RUN DURING PHASE 17 ═══
-- Future manual enablement: SMP shop_sell earn-only trial
update public.economy_server_policies
set
  server_group = 'smp',
  enabled = true,
  can_read = true,
  can_reward = false,
  can_earn = true,
  can_spend = false,
  max_credit_minor = 50000,
  max_debit_minor = 50000,
  max_batch_count = 100,
  notes = 'SMP shop_sell earn-only live trial. No vote rewards; no spend.',
  updated_at = now()
where server_id = 'smp-1'
  and server_group = 'smp';
```

After a **future** approved run, verify:

```sql
select server_id, can_read, can_reward, can_earn, can_spend,
       max_credit_minor, max_debit_minor, max_batch_count
from public.economy_server_policies
where server_id = 'smp-1';
```

Canonical copy also lives in `docs/sql/economy-smp-gameplay-write-trial.sql` (commented).

---

## 5. Rollback SQL (restore SMP read-only policy)

Use if a live trial was enabled by mistake or after trial completion. Reverts
**policy only** — does not delete ledger rows.

```sql
-- Policy rollback: SMP read-only (Phase 5 / migration 024 shape)
update public.economy_server_policies
set
  server_group = 'smp',
  enabled = true,
  can_read = true,
  can_reward = false,
  can_earn = false,
  can_spend = false,
  max_credit_minor = 0,
  max_debit_minor = 0,
  max_batch_count = 0,
  notes = 'SMP read-only DB economy access for shadow/alignment rollout.',
  updated_at = now()
where server_id = 'smp-1'
  and server_group = 'smp';
```

Verify rollback:

```sql
select server_id, can_earn, can_spend, can_reward, max_credit_minor, max_batch_count
from public.economy_server_policies
where server_id = 'smp-1';
```

Incorrect ledger entries require **compensating append-only** entries — never
delete or update `economy_ledger` / `economy_balances` in place.

---

## 6. Optional API verification (read-only)

No transaction POST. No ledger rows created.

### Plugin balance read (HMAC)

1. On SMP with valid `baseUrl` + `hmacSecret`, run:  
   `/rf economy gameplay preflight dryrun`  
   Confirms config; may probe `POST /api/plugin/economy/balance` read-only.
2. Or staff command:  
   `/rf economy balance <online-player|uuid>`  
   (read-only DB balance + local Vault delta display; no writes.)

### Website route (service role — staff/backend only)

`POST /api/plugin/economy/balance` → RPC `get_plugin_economy_balance`.  
Requires plugin HMAC headers; not for browser clients.

**Pass:** SMP `smp-1` with `can_read=true` returns balance JSON; auth failures indicate HMAC/config issues, not missing schema.

**Do not** call `POST /api/plugin/economy/transactions` during Phase 17.

---

## 7. Stop conditions (do not start live SMP `shop_sell` trial)

Stop and fix before any live policy enablement if:

| Condition | Action |
|-----------|--------|
| Migration **018** or **026** not applied / category constraint missing `shop_sell` | Apply missing migrations in staging first; plan production apply separately |
| Migration **024** not applied / `smp-1` policy row missing | Apply 024 or restore row |
| `smp-1` has `can_earn=true` or `can_spend=true` **before** intentional trial | Roll back policy; investigate |
| `lobby-1` has `can_reward=false` or `enabled=false` | Restore Lobby vote policy immediately |
| `anarchy-1` enabled or any write cap &gt; 0 | Disable; verify RPC still blocks Anarchy |
| `economy_balances` / `economy_ledger` missing | Complete foundation migration |
| Recent `vote_reward` rows absent while votes are live | Fix Lobby path before gameplay |
| Phase 16 dry-run created `shop_sell` ledger rows | Incident review; rollback plugin config |
| Category counts for `shop_sell` increased without approved live trial | Stop; no policy enablement |

---

## 8. Phase 17 completion checklist

- [ ] Migration inventory reviewed; production `schema_migrations` or object check recorded
- [ ] **018, 019, 024, 026** confirmed applied (plus import migrations if used)
- [ ] Category constraint verification (section A) **pass**
- [ ] Policy rows match section C (**smp-1** read-only; **lobby-1** `can_reward=true`)
- [ ] Balances and ledger sanity (sections D–F) **pass**
- [ ] Phase 16 dry-run counts documented; `shop_sell` unchanged
- [ ] Live-trial `UPDATE` **not** executed
- [ ] Optional read-only API/HMAC check documented in run log
- [ ] Operator sign-off for **Phase 18+** (live trial) recorded separately

---

## Related files

| Path | Role |
|------|------|
| `supabase/migrations/202605240018_global_economy_foundation.sql` | Foundation |
| `supabase/migrations/202605250024_smp_readonly_economy_policy.sql` | SMP read-only |
| `supabase/migrations/202605270026_economy_transaction_categories.sql` | Categories |
| `docs/sql/economy-smp-gameplay-write-trial.sql` | Commented manual trial/rollback SQL |
| `supabase/tests/database/economy_categories.test.sql` | Category/policy tests (local CI) |
