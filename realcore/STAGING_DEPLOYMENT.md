# RealCore Staging Deployment Checklist

This checklist is for the first RealCore install on a staging backend server such as `Lobby1`.

RealCore is a backend Paper/Purpur/Folia plugin. Do not install this jar on Velocity.

## 1. Build the Jar

From the website repository root:

```bash
mvn -q -f realcore/pom.xml clean package
```

Jar path:

```text
realcore/target/RealCore-0.1.0-SNAPSHOT.jar
```

## 2. Generate the Shared HMAC Secret

Generate one strong secret and use the same value in both places:

```bash
openssl rand -hex 32
```

Keep this value private. Never paste it in Discord, console screenshots, tickets, or public logs.

## 3. Website / Cloudflare Environment Variables

Set these on the staging website deployment:

```text
REALCORE_PLUGIN_SECRET=<the generated secret>
REALCORE_ALLOW_SHARED_SECRET=false
```

`REALCORE_ALLOW_SHARED_SECRET` should stay unset or `false` for normal staging and production. RealCore uses HMAC headers.

## 4. Copy the Jar to Lobby1

Stop the backend server first, then copy:

```text
realcore/target/RealCore-0.1.0-SNAPSHOT.jar
```

to:

```text
<Lobby1 server folder>/plugins/RealCore-0.1.0-SNAPSHOT.jar
```

Start Lobby1 once so the config is created:

```text
<Lobby1 server folder>/plugins/RealCore/config.yml
```

Stop Lobby1 again before editing config.

## 5. Configure Lobby1

Minimum staging config:

```yaml
baseUrl: "https://realfiction.live"
serverId: "lobby-1"
serverGroup: "global"
hmacSecret: "<the generated secret>"

pollIntervalSeconds: 30
requestTimeoutSeconds: 10
pollLimit: 25
debug: true
```

Use a unique `serverId` per backend server:

```text
lobby-1
arcade-1
smp-1
anarchy-1
```

For first staging, keep `serverGroup: "global"` unless the website reward queue is explicitly configured for another group.

## 6. Restart Steps

1. Stop Lobby1.
2. Confirm LuckPerms is installed and enabled.
3. Copy/update the RealCore jar.
4. Edit `plugins/RealCore/config.yml`.
5. Start Lobby1.
6. Watch startup logs. The HMAC secret should never appear.

## 7. Commands to Test

Console or staff in game:

```text
/realfiction status
/realfiction reload
/realfiction status
```

Expected status:

```text
Plugin: ready
Server ID: lobby-1
Base URL: https://realfiction.live
Poll interval: 30s
Scheduler: Paper/Purpur
Reward polling: ready
LuckPerms: ready
Website auth: ready
```

On Folia, `Scheduler` should show `Folia`.

Player account link:

```text
/realfiction link <code>
```

Expected:

- Valid code links the player's Minecraft account.
- Invalid or expired code shows a friendly failure message.
- The server console logs the player name and result, but not the secret.

Reward delivery:

1. Queue one staging vote reward or cosmetic reward.
2. Wait for the next poll.
3. Confirm log lines:

```text
Delivering rewardId=<uuid> action=grant rewardKey=<key>
Acknowledged rewardId=<uuid> status=delivered duplicate=false
```

Failure test:

1. Temporarily configure a harmless invalid command reward.
2. Queue a staging reward for that key.
3. Confirm RealCore marks it failed with a reason.

## 8. Do Not Proceed If

- `/realfiction status` says `Website auth: not ready`.
- `/realfiction status` says `Reward polling: not ready` after a valid secret is configured.
- LuckPerms is not hooked for a reward that needs permissions or ranks.
- The server log prints the HMAC secret.
- A reward grants twice during one staging test.
- The website returns `Plugin server identity mismatch.`

## 9. Known First-Stage Limits

- RealCore has not been live-tested on Lobby1 yet.
- Gift card rewards fail safely until website-side gift card code delivery is completed.
- If the server crashes after a local grant but before acknowledgement, staff may need to inspect the reward queue before replaying.
