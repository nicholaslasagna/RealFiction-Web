# Economy Balance Audit Comparison

Phase 4C is a reporting-only step. It helps staff compare the current local
Vault/EssentialsX balances across backend servers before choosing one canonical
source for a later reviewed import.

Do not import balances during this step. Do not write the global economy ledger.
Do not change Vault, EssentialsX, rewards, or gameplay economy behavior.

## Goal

Create one clear balance comparison report across:

- Lobby1
- SMP
- Factions
- Arcade

Anarchy can be audited for visibility, but Anarchy must not be chosen as a
canonical source for the main network economy.

## Inputs

Run the read-only RealCore audit command on each backend that has Vault economy:

```text
/rf economy audit all 10000
```

For a small smoke check before the full export:

```text
/rf economy audit online
```

Each audit writes a CSV under:

```text
plugins/RealCore/audits/
```

Expected columns:

```text
serverId,serverGroup,minecraftUuid,username,localVaultBalance
```

Save each CSV with a stable name before comparing:

```text
vault-lobby1.csv
vault-smp.csv
vault-factions.csv
vault-arcade.csv
```

Keep the raw CSVs unchanged. Use a copy for cleanup, sorting, notes, and
spreadsheet formulas.

## Comparison Sheet

Create one row per Minecraft UUID. Do not join by username alone because player
names can change.

Recommended columns:

```text
minecraft_uuid
latest_username
lobby1_balance
smp_balance
factions_balance
arcade_balance
seen_on_servers
matching_balances
canonical_source
recommended_import_balance
flags
staff_decision
reason
reviewer
reviewed_at
```

Use the UUID as the identity key. Usernames are labels only.

## Duplicate Player Handling

A duplicate is a UUID that appears in more than one server export.

Rules:

1. If all balances match, mark `matching_balances=true`.
2. If balances differ, mark `flags=conflict`.
3. Do not average balances.
4. Do not sum balances across servers.
5. Do not automatically choose the largest balance.
6. Use the selected canonical server balance unless staff explicitly records a
   different decision and reason.

Conflict example:

```text
uuid: <player uuid>
lobby1: 250
smp: 18420
factions: 950
arcade: 250
canonical_source: smp
recommended_import_balance: 18420
flags: conflict
reason: SMP selected as canonical source for survival economy
```

## Missing Player Handling

A missing player is present in one or more server exports but absent from the
selected canonical source.

Rules:

1. Mark `flags=missing_from_canonical`.
2. Check whether the player is expected to have a balance on the canonical
   server.
3. If the player is a known network player and the balance exists only on a
   non-canonical server, staff must decide whether to import the non-canonical
   balance.
4. If the player only appears on Lobby1/Arcade with a zero or tiny balance,
   consider excluding the row from import.
5. Never import a missing player without a recorded reason.

Recommended actions:

```text
import_canonical
import_noncanonical_with_reason
exclude_zero_or_noise
manual_review
```

## Huge-Balance Anomaly Detection

Flag balances that look too large before import. Use both absolute and relative
checks.

Suggested first-pass flags:

- `huge_balance`: balance is greater than `$1,000,000`
- `extreme_outlier`: balance is more than 10x the next-highest normal active
  player balance
- `server_conflict_large`: same UUID has a large difference between servers
  (for example more than `$10,000`)
- `noncanonical_huge`: the largest balance is on a server that is not the
  chosen canonical source

Do not import huge balances automatically. Require staff review and a written
reason.

Report huge balances like this:

```text
uuid: <player uuid>
username: <name>
server: factions
balance: 2500000
flag: huge_balance
decision: manual_review
reason: verify with EssentialsX data and staff logs before import
```

## Negative Balance Detection

The global economy v1 rejects negative balances. Negative local balances must
not be imported directly.

Rules:

1. Mark `flags=negative_balance`.
2. Do not import the row until reviewed.
3. If staff chooses to preserve debt later, that needs a separate approved
   negative-balance design.
4. For v1 migration, recommended default is to import zero or exclude the row,
   but only with a recorded staff decision.

Report negative balances like this:

```text
uuid: <player uuid>
username: <name>
server: smp
balance: -250
flag: negative_balance
decision: manual_review
reason: v1 global economy rejects negative balances
```

## Choosing The Canonical Source

Choose one canonical source before any import work. Do not mix sources by
default.

Recommended decision order:

1. Pick the server that currently owns the most trusted economy gameplay loop.
2. Prefer the server with the most complete active-player balances.
3. Prefer the server with fewer extreme anomalies.
4. Prefer the server with the clearest rollback story.
5. Do not choose Anarchy for main network economy.

Likely roles:

- Lobby1: display/rewards only; usually not canonical for gameplay money.
- SMP: strong candidate if survival economy is the intended main source.
- Factions: strong candidate only if Factions is the intended main source.
- Arcade: usually small rewards only; usually not canonical.
- Anarchy: read-only audit only; never canonical for the main economy.

The final recommendation must state exactly one canonical source, or explicitly
state that no import should happen yet.

## Recommendation Format

Use this format for the final audit report:

```text
Economy Balance Audit Recommendation

Audit date:
Reviewer:

Files reviewed:
- Lobby1:
- SMP:
- Factions:
- Arcade:

Recommended canonical source:

Why this source:

Summary:
- Total unique players:
- Players present on canonical source:
- Players missing from canonical source:
- Duplicate/conflicting rows:
- Huge-balance anomalies:
- Negative-balance anomalies:
- Rows recommended for import:
- Rows requiring manual review:
- Rows excluded:

Import recommendation:
- Proceed / Do not proceed
- Proposed import batch id:
- Proposed reason:

Top risks:

Manual review list:
```

For each manual review row:

```text
uuid:
username:
lobby1:
smp:
factions:
arcade:
flags:
recommended action:
reason:
```

## Import Readiness Checklist

Do not move to import tooling until all are true:

- Raw CSVs are saved for Lobby1, SMP, Factions, and Arcade.
- UUID-based comparison sheet is complete.
- Canonical source is selected in writing.
- Duplicate conflicts are reviewed.
- Missing players are reviewed.
- Huge balances are reviewed.
- Negative balances are reviewed.
- Proposed import rows are exported as a separate reviewed file.
- Import batch id and reason are chosen.
- Rollback plan is written.

## Rollback And Import Strategy

This phase does not import anything, but the report must prepare for a safe
future import.

Future import rules:

1. Import with `migration_import` entries only through an approved
   admin/service path.
2. Use one stable import batch id.
3. Use one stable idempotency key per imported player, such as:

   ```text
   migration-import:<batch-id>:<minecraft-uuid>:realfiction_main
   ```

4. Keep the original CSVs and reviewed import file permanently.
5. Never delete ledger rows to roll back.
6. Roll back by creating compensating ledger entries only.
7. Disable write policies during review and after the test import.
8. Start with dry-run, then a tiny staging import, before any production import.

Rollback report format:

```text
Rollback batch id:
Original import batch id:
Reason:
Rows compensated:
Total credit reversed:
Total debit reversed:
Reviewer:
```

## Stop Conditions

Stop and do not import if:

- A CSV is missing from a required backend.
- UUIDs are missing or malformed.
- A large number of players only exist on non-canonical servers.
- Any negative balances are not reviewed.
- Huge-balance anomalies are unexplained.
- Staff cannot agree on the canonical source.
- The proposed import file was manually edited without review.
- The rollback plan is not written.
