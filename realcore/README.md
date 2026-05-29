# RealCore

RealCore is the RealFiction Minecraft plugin for account linking and reward delivery.

This first phase is a buildable skeleton for staging tests. It is not production-ready until it has been tested on the RealFiction staging server with the live website endpoints.

## What It Does

- Signs every website request with RealFiction HMAC headers.
- Adds `/realfiction link <code>` for players.
- Polls pending rewards from the website.
- Delivers supported rewards once.
- Acknowledges each reward as `delivered` or `failed`.
- Logs reward ids, reward keys, action type, and status without printing secrets.

## Supported Reward Delivery

- LuckPerms group grants and revokes.
- LuckPerms permission grants and revokes.
- LuckPerms prefix and suffix grants and revokes.
- Console command rewards from `config.yml`.
- Vote economy commands from `config.yml`.
- Cosmetic product permissions from `config.yml`.

Gift card rewards currently fail safely with a clear reason because the website reward payload exposes value only, not a generated redeem code.

## Build

Requirements:

- Java 21
- Maven 3.9+

```bash
cd realcore
mvn clean package
```

The plugin jar is written to:

```text
realcore/target/RealCore.jar
```

For first staging deployment, follow:

```text
realcore/STAGING_DEPLOYMENT.md
```

## Install

1. Build the jar.
2. Stop the Minecraft backend server.
3. Place the jar in the backend server `plugins/` folder.
4. Start the server once so `plugins/RealCore/config.yml` is created.
5. Stop the server.
6. Edit `config.yml`.
7. Start the server again.

RealCore belongs on backend servers such as Lobby1, Arcade, SMP, and Anarchy. Velocity does not run this Bukkit/Paper plugin.

RealCore supports Paper/Purpur and Folia. On Folia it uses the async scheduler for polling/API work, the global region scheduler for server-wide console command dispatch, and player schedulers for player messages.

## Config

Minimum required values:

```yaml
baseUrl: "https://realfiction.live"
serverId: "lobby-1"
serverGroup: "global"
hmacSecret: "paste-secret-here"
pollIntervalSeconds: 30
requestTimeoutSeconds: 10
debug: false
```

Never share `hmacSecret`. RealCore never logs it.

Use a unique `serverId` per backend server:

- `lobby-1`
- `arcade-1`
- `smp-1`
- `anarchy-1`

Use `serverGroup` to control which rewards a server may claim. The website currently sends most rewards to `global`.

## Account Linking Test

1. Sign in on the RealFiction website.
2. Start Minecraft linking from the account page.
3. Copy the generated command.
4. In game, run:

```text
/realfiction link CODE
```

Expected:

- Player sees a friendly success message.
- Website account shows the Minecraft name as linked.
- Invalid or expired codes show a friendly failure message.

## Reward Test

1. Configure `hmacSecret`.
2. Ensure LuckPerms is installed.
3. Queue a staging reward from the website.
4. Watch server logs.

Expected log shape:

```text
Delivering rewardId=<uuid> action=grant rewardKey=store.realvip-monthly
Acknowledged rewardId=<uuid> status=delivered duplicate=false
```

If delivery fails, RealCore acknowledges it as failed with a reason. If the website is down, RealCore retries on the next poll.

## Leaderboard Placeholders

RealCore caches network stat leaderboards (playtime today; votes/economy/etc. as new producers land) and exposes them through PlaceholderAPI.

Generic stat placeholders:

```text
%realcore_stat_playtime.total_top_1_name%
%realcore_stat_playtime.total_top_1_time%      # 1d 3h 12m
%realcore_stat_playtime.total_top_1_value%     # raw seconds
%realcore_stat_playtime.smp_top_1_time%
%realcore_stat_votes.total_top_1_name%
```

Legacy playtime placeholders (still supported):

```text
%realcore_playtime_total_top_1_name%
%realcore_playtime_total_top_1_time%
%realcore_playtime_player_total%
```

The cache refresh interval and which keys to cache are set in `config.yml` under `stats.refreshSeconds` and `stats.leaderboards`. Disable the whole subsystem with `modules.stats: false`. See `docs/REALCORE_PLUGIN.md` for the full placeholder reference and API contract.

`/rf stats` (admin) shows current cache size, configured keys, refresh counts, and the last fetch error.

## Staff Commands

```text
/realfiction status
/rf status
/realcore status
/realfiction reload
```

`/realfiction`, `/rf`, and `/realcore` are all registered as root commands and share the same command handler. `status` shows whether RealCore is enabled, the server id, base URL, poll interval, reward polling state, LuckPerms hook state, and whether website auth is configured. It never prints the HMAC secret.
It also shows which scheduler mode RealCore detected: `Paper/Purpur` or `Folia`.

`reload` reloads `config.yml`, restarts the HTTP client and reward poller, and reports failure if the config cannot be loaded safely.

## Command Rewards

Commands are configured in `config.yml`:

```yaml
rewards:
  commands:
    byRewardKey:
      vote.standard:
        - "eco give {player} 250"
    byProductSlug:
      cosmetic-atelier:
        - "lp user {player} permission set realfiction.cosmetics.atelier true"
```

Placeholders:

- `{player}`
- `{username}`
- `{uuid}`
- `{rewardKey}`
- `{rewardId}`
- `{quantity}`
- `{serverId}`
- `{productSlug}`
- `{voteSite}`

Vote reward player messages are also configured in `config.yml` under
`rewards.messages`. Broadcasts are disabled by default and can be enabled only
when staff want public vote announcements.

Keep command rewards fair. Do not add paid kits, combat boosts, economy multipliers for store purchases, claim advantages, PvP advantages, or server-balance perks.

## Staging Checklist

- `mvn clean package` succeeds.
- Server starts without printing the HMAC secret.
- `/realfiction link <code>` succeeds with a valid code.
- Invalid link code fails cleanly.
- Poll route rejects bad secrets.
- Poll route accepts HMAC-signed RealCore calls.
- LuckPerms group grant works.
- LuckPerms group revoke works.
- LuckPerms permission grant works.
- Vote command reward works.
- Ack marks rewards delivered.
- Failed delivery marks rewards failed.
- Restarting RealCore does not double-grant an already delivered reward.
