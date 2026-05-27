# Production candidate readiness (Phase 19)

**Purpose:** Repo-side gate before the first SMP jar deploy. This is not production-proven SMP behavior — it is the maximum verification possible without live server testing.

**Waterfall position:** Stage 3 — after feature implementation (Stage 2), before freeze/deploy (Stage 4) and your SMP Gates A/B/C (Stage 5).

---

## Verdict criteria

| Label | Meaning |
|-------|---------|
| **Production candidate READY** | No repo blockers; safe bundled defaults; tests green; jar builds; operator docs match code |
| **Production-proven** | Requires SMP testing with real EconomyShopGUI/Vault/plugin stack |

---

## Pre-deploy checklist (operator)

1. Build from approved `main` commit and record SHA256:
   ```bash
   git rev-parse HEAD
   mvn -q -f realcore/pom.xml package -DskipTests
   shasum -a 256 realcore/target/RealCore-0.1.0-SNAPSHOT.jar
   ```
2. Copy jar to SMP; **do not** enable live writes for Stage 2 dry-run.
3. Merge bundled defaults into live `config.yml` (RealCore `copyDefaults` on reload helps).
4. Set `server.id: smp-1`, `hmacSecret`, `baseUrl`.
5. Gate A: `modules.economy=true`, `economy.enabled=true`, `gameplaySync.enabled=false` → `/rf economy gameplay preflight dryrun` READY.
6. Gates B/C: enable producers with `dryRun=true` only; verify `[GameplaySync:DRYRUN]` logs; `queued=0`.
7. **Never** run `/rf economy test` during dry-run soak (global writer bypass).
8. Use `/rf economy gameplay simulate` only for generic path testing (generic disabled by default).

---

## Safety invariants (code)

- Gameplay dry-run: capture returns before buffer enqueue; buffer `propose()` returns DRY_RUN; flush tick skips `drainToWriter()` when `gameplaySync.dryRun=true`.
- Live writes require: `modules.economy`, `economy.enabled`, `gameplaySync.enabled`, `gameplaySync.dryRun=false`, producer enabled, producer `dryRun=false`, category enabled, backend allowlisted, Anarchy blocked, writer running, DB policy `can_earn`/`can_spend` (operator SQL).
- Vote rewards: separate `VoteRewardLedgerWriteService`; gameplay categories exclude `vote_reward`.
- Reload: producers call `stop()` before `start()`; sync service recreated on reload.

---

## Commands (admin: `realcore.admin`)

| Command | Purpose |
|---------|---------|
| `/rf status` | Module + economy summary |
| `/rf economy` | Global writer / buffer status |
| `/rf economy gameplay` | Gameplay sync + aggregate metrics |
| `/rf economy gameplay producers` | Per-producer metrics |
| `/rf economy gameplay preflight dryrun` | Dry-run readiness |
| `/rf economy gameplay preflight live` | Live-write readiness (future) |
| `/rf economy gameplay simulate …` | Generic producer dry-run (disabled by default) |

---

## Related docs

- [ECONOMY_WATERFALL_OPERATOR_CHECKLISTS.md](./ECONOMY_WATERFALL_OPERATOR_CHECKLISTS.md) — Gates A/B/C
- [ECONOMY_GAMEPLAY_PREFLIGHT.md](./ECONOMY_GAMEPLAY_PREFLIGHT.md) — Preflight detail
- [ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md](./ECONOMY_SMP_SHOP_SELL_DRY_RUN_ROLLOUT.md) — Gate B soak
