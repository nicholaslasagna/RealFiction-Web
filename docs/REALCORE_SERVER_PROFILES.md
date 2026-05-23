# RealCore Backend Server Profiles

Reference guide for configuring RealCore across the RealFiction network. Each
Minecraft backend gets its own `config.yml`; only the **top section** (identity,
auth, and `modules:` toggles) differs per server. Everything below — `lobby:`,
`cosmetics:`, `menus:`, `scoreboard:`, `playtime:`, `stats:`, `rewards.*` — can
stay as the default RealCore writes on first run.

**Documentation only.** This file does not change plugin defaults, migrations,
website routes, or deployment state.

---

## How grouping works

RealCore tracks network stats by **`server.group`**, not by individual worlds.

| Backend | `server.id` (example) | `server.group` | Worlds |
|--|--|--|--|
| Lobby1 | `lobby-1` | `lobby` | Void_Spawn, hub worlds |
| Arcade | `arcade-1` | `arcade` | Lobby_Games, minigame maps |
| SMP | `smp-1` | `smp` | overworld, nether, end |
| Factions | `factions-1` | `factions` | overworld, nether, end, old-factions, … |
| Anarchy | `anarchy-1` | `anarchy` | overworld, nether, end, … |

All worlds on one backend share the same group automatically. A Factions server
with overworld, Nether, End, and legacy worlds still rolls up to `playtime.factions`
and `factions.*` stat keys — no per-world config is required.

`server.group` also drives:

- Playtime leaderboards (`playtime.lobby`, `playtime.smp`, …)
- Generic stat scopes (`kills.factions`, `blocks_broken.smp`, …)
- Website reward targeting via `server_group` on the reward queue (for
  per-group crates or grants later)

---

## Shared vs per-backend settings

| Setting | Scope | Notes |
|--|--|--|
| `baseUrl` | **Shared** | `https://realfiction.live` on every backend |
| `hmacSecret` | **Shared** | Must match the website env `REALCORE_PLUGIN_SECRET` |
| `server.id` | **Unique per backend** | Never reuse; used in HMAC signing and heartbeats |
| `server.group` | **One per backend role** | Drives leaderboard/stat scoping |
| `server.displayName` | Per backend | Cosmetic label in logs and `/rf status` |
| `modules.*` | Per backend | Feature toggles (see profiles below) |
| `playtime:` / `stats:` | Usually identical | Keep defaults on all backends unless you have a reason to differ |

### Identity rules

- **`server.id` must be unique** across the network. Duplicate ids cause
  heartbeat collisions and ambiguous reward attribution. Set
  `refuseOnDuplicate: true` on production backends if you want RealCore to
  disable itself when another live server already owns the id.
- **`hmacSecret` and `baseUrl` are the same jar-to-website contract** on every
  backend. Differentiation is done via `server.id` in the signed HMAC message,
  not via separate secrets.

### Playtime vs stats modules

RealCore exposes **two separate module flags** (see `modules:` in `config.yml`):

| Module | What it gates |
|--|--|
| `modules.playtime` | Session tracking → `POST /api/plugin/playtime/session` → network playtime totals |
| `modules.stats` | Leaderboard cache refresh, stat placeholders, buffered stat writer + producers |

Both should stay **`true` on every backend** in the profiles below. Disabling
`playtime` stops session ingest for that server; disabling `stats` stops
placeholder/hologram cache and stat producers on that backend only.

The shared `stats:` block (`enabled`, `refreshSeconds`, `leaderboards`, `writer`,
`producers`) is configured once in the default config and is normally identical
on all five servers. `/rf status` reports `playtime=on, stats=on` when both
modules are enabled.

---

## Reward delivery (read this first)

If **every** backend has `modules.rewards: true`, any backend can poll and
**deliver** a queued reward. That is correct for network-wide grants (LuckPerms
ranks, cosmetics, crate keys) because permissions sync globally.

It is **risky for economy commands** (`eco give`, etc.) when each backend runs
its own Vault balance — a vote reward might execute on the wrong server.

**Default in these profiles:** `rewards: true` on **Lobby1 only**, `false`
elsewhere. Lobby1 is the canonical delivery point for vote/store rewards and
the network economy.

| Your setup | Set `modules.rewards: true` on |
|--|--|
| Single shared / synced economy (typical) | Lobby1 only |
| Network-synced economy, any backend OK | Every backend (atomic claim prevents double delivery) |
| SMP (or another server) owns the economy | That server instead of (or in addition to) Lobby1 |

LuckPerms ranks and cosmetic permissions still propagate network-wide regardless
of which backend delivers the reward.

---

## Profile 1 — Lobby1 (full lobby + canonical rewards)

Drop this block at the top of `config.yml`. Keep the default `lobby:`, `cosmetics:`,
`menus:`, `scoreboard:`, `playtime:`, and `stats:` sections below.

```yaml
baseUrl: "https://realfiction.live"

server:
  id: "lobby-1"
  group: "lobby"
  displayName: "Lobby 1"
  refuseOnDuplicate: false

hmacSecret: "CHANGE_ME"   # same on every backend (= REALCORE_PLUGIN_SECRET)

pollIntervalSeconds: 30
requestTimeoutSeconds: 10
pollLimit: 25
debug: false

modules:
  rewards: true            # canonical vote/store delivery + eco commands
  cosmetics: true
  lobby: true              # menus, scoreboard, flight, protection (scoped to lobby.worlds)
  menus: true
  scoreboards: true
  economy: true
  votes: true
  punishments: false
  chat: false
  playtime: true           # session tracking for this backend
  stats: true              # leaderboard cache + placeholders + stat writer
```

Configure `lobby.worlds` and `lobby.spawn` for your hub (e.g. `Void_Spawn`).

---

## Profile 2 — Arcade (games + cosmetics, no lobby protection)

```yaml
baseUrl: "https://realfiction.live"

server:
  id: "arcade-1"
  group: "arcade"
  displayName: "Arcade"
  refuseOnDuplicate: false

hmacSecret: "CHANGE_ME"

pollIntervalSeconds: 30
requestTimeoutSeconds: 10
pollLimit: 25
debug: false

modules:
  rewards: false           # delivered on Lobby1; true only if Arcade holds the economy
  cosmetics: true          # cosmetic GUI is safe (no gameplay advantage)
  lobby: false             # OFF — lobby protection must not break BedWars / PvP / Murder Mystery
  menus: false
  scoreboards: false
  economy: false
  votes: false
  punishments: false
  chat: false
  playtime: true
  stats: true
```

**Optional hub:** If Arcade has a small selector hub, you can set `lobby: true`
and scope `lobby.worlds: [<hub world only>]` so game worlds stay unprotected.

---

## Profile 3 — SMP (survival)

Overworld, Nether, and End all count as `smp` playtime automatically.

```yaml
baseUrl: "https://realfiction.live"

server:
  id: "smp-1"
  group: "smp"
  displayName: "SMP"
  refuseOnDuplicate: false

hmacSecret: "CHANGE_ME"

pollIntervalSeconds: 30
requestTimeoutSeconds: 10
pollLimit: 25
debug: false

modules:
  rewards: false           # true only if SMP is your canonical economy server
  cosmetics: false         # optional: true if you want the cosmetics GUI here
  lobby: false
  menus: false
  scoreboards: false
  economy: false
  votes: false
  punishments: false
  chat: false
  playtime: true
  stats: true
```

---

## Profile 4 — Factions (multi-world, Folia)

All Factions worlds (overworld, nether, end, legacy maps) share one
`factions` group.

**Folia requirement:** Install a RealCore build with `folia-supported: true` in
`plugin.yml` (merged in PR #18). Standard Paper/Purpur jars refuse to enable on
Folia regionized servers.

```yaml
baseUrl: "https://realfiction.live"

server:
  id: "factions-1"
  group: "factions"
  displayName: "Factions"
  refuseOnDuplicate: false

hmacSecret: "CHANGE_ME"

pollIntervalSeconds: 30
requestTimeoutSeconds: 10
pollLimit: 25
debug: false

modules:
  rewards: false           # true only if Factions runs its own canonical economy
  cosmetics: false         # optional
  lobby: false
  menus: false
  scoreboards: false
  economy: false
  votes: false
  punishments: false
  chat: false
  playtime: true
  stats: true
```

---

## Profile 5 — Anarchy (multi-world)

```yaml
baseUrl: "https://realfiction.live"

server:
  id: "anarchy-1"
  group: "anarchy"
  displayName: "RealAnarchy"
  refuseOnDuplicate: false

hmacSecret: "CHANGE_ME"

pollIntervalSeconds: 30
requestTimeoutSeconds: 10
pollLimit: 25
debug: false

modules:
  rewards: false           # true only if Anarchy runs its own canonical economy
  cosmetics: false         # optional
  lobby: false
  menus: false
  scoreboards: false
  economy: false
  votes: false
  punishments: false
  chat: false
  playtime: true
  stats: true
```

---

## Quick reference matrix

| Backend | `server.group` | `rewards` | `lobby` | `cosmetics` | `playtime` | `stats` |
|--|--|--|--|--|--|--|
| Lobby1 | `lobby` | **true** | **true** | true | true | true |
| Arcade | `arcade` | false | false | true | true | true |
| SMP | `smp` | false | false | optional | true | true |
| Factions | `factions` | false | false | optional | true | true |
| Anarchy | `anarchy` | false | false | optional | true | true |

---

## Deployment checklist

Use this when rolling RealCore onto a new backend or changing `modules:`.

1. **Build / jar**
   - [ ] Paper/Purpur backends: standard RealCore jar from `main`
   - [ ] Factions (Folia): jar built from a branch with `folia-supported: true` (PR #18+)

2. **Config top section**
   - [ ] Unique `server.id` (no duplicate with any other live backend)
   - [ ] Correct `server.group` for the server's role
   - [ ] `hmacSecret` matches `REALCORE_PLUGIN_SECRET` on the Cloudflare Worker
   - [ ] `baseUrl: "https://realfiction.live"`
   - [ ] `modules.playtime: true` and `modules.stats: true` unless you have a documented reason to disable either

3. **Reward policy**
   - [ ] Exactly one (or intentionally chosen) backend has `modules.rewards: true` for economy commands
   - [ ] Vote/store reward commands in `rewards.commands.byRewardKey` are appropriate for that backend

4. **Lobby scoping**
   - [ ] If `modules.lobby: true`, `lobby.worlds` lists **only** hub worlds — not game/survival worlds
   - [ ] Game backends (`lobby: false`) do not accidentally inherit lobby protection on PvP maps

5. **Stat producers (shared `stats:` block)**
   - [ ] `stats.producers.economyMirror` stays `false` unless one backend runs Vault + authoritative economy
   - [ ] Migration 017 applied to Supabase before enabling kills/votes/blocks stat ingestion in production

6. **Smoke test (in-game)**
   - [ ] `/rf status` — modules summary shows expected flags (`playtime=on, stats=on`, …)
   - [ ] Join + wait 60s — playtime session flush succeeds (check website or `/rf stats`)
   - [ ] On Lobby1 with `rewards: true` — test vote delivery reaches the right player
   - [ ] Placeholder spot-check: `%realcore_stat_playtime.total_top_1_name%` (requires `modules.stats: true`)

---

## Safety notes

- **Never commit real `hmacSecret` values** to git or paste them in Discord tickets.
- **Duplicate `server.id`** causes severe heartbeat warnings and ambiguous platform state; fix immediately.
- **`lobby: true` on a PvP/minigame backend** can cancel block break, PvP, hunger, etc. in scoped worlds — keep `lobby: false` on Arcade/SMP/Factions/Anarchy unless you explicitly scope a hub.
- **Stat writer without migration 017** — POSTs to `/api/plugin/stats/events` return 503; the writer retries safely but stats will not land until the migration is applied.
- **`money.*` stats** are plugin-only on the website; keep `economyMirror: false` unless one backend owns Vault.
- **RealFactions** is unrelated to RealCore `server.group`; faction gameplay plugins do not replace network stat grouping.

---

## Related docs

- [REALCORE_PLUGIN.md](./REALCORE_PLUGIN.md) — API routes, HMAC auth, placeholders, `/rf stats`
- Default template: `realcore/src/main/resources/config.yml`
