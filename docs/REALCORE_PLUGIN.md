# RealCore Plugin Architecture

`RealCore` is the planned RealFiction Minecraft plugin that replaces Tebex fulfillment and connects Purpur/Folia/Paper servers to the platform backend.

## Runtime Targets

- Java 21.
- Purpur.
- Folia.
- Modern Paper APIs.
- LuckPerms API.
- Redis adapter later if queue scale requires it.

## Plugin Auth Model

All plugin routes require `REALCORE_PLUGIN_SECRET`.

Preferred production auth is HMAC:

```text
x-realfiction-plugin-server-id: lobby-1
x-realfiction-plugin-timestamp: 1779300000000
x-realfiction-plugin-nonce: unique-random-nonce
x-realfiction-plugin-signature: hex(hmac_sha256(secret, "serverId.timestamp.nonce.METHOD./path.rawBody"))
```

Replay protection:

- Timestamp must be within five minutes of the platform clock.
- Nonces are hashed and stored in `plugin_request_nonces`.
- Reused nonces are rejected.
- Expired nonces are pruned by `public.cleanup_plugin_request_nonces()` (scheduled per-environment); replay safety does not depend on the prune.

The server id is part of the signed message, so a server cannot spoof another server's id even though all servers currently share one secret.

Shared-secret auth is opt-in for staging/bootstrap only. It is rejected unless `REALCORE_ALLOW_SHARED_SECRET=true`, and must stay unset in production so HMAC is required:

```text
x-realfiction-plugin-secret: REALCORE_PLUGIN_SECRET
```

or:

```text
Authorization: Bearer REALCORE_PLUGIN_SECRET
```

## Current Website Endpoints For RealCore

### Confirm Minecraft Account Link

```text
POST /api/plugin/account-link/confirm
```

Payload:

```json
{
  "serverId": "lobby-1",
  "verificationCode": "ABCD2345",
  "minecraftUuid": "player-uuid-with-or-without-dashes",
  "minecraftUsername": "PlayerName",
  "platform": "java"
}
```

Behavior:

- Expires stale pending links.
- Matches the server-stored verification code hash.
- Finalizes only pending links.
- Writes UUID, verified status, and verified timestamp.
- Clears the stored hash.
- Updates profile primary Minecraft fields.
- Returns no private account data.

### Poll Rewards

```text
POST /api/plugin/rewards/poll
```

Payload:

```json
{
  "serverId": "lobby-1",
  "serverGroup": "global",
  "limit": 25,
  "capabilities": ["luckperms", "cosmetics", "vote_rewards"]
}
```

Response:

```json
{
  "server": {
    "id": "lobby-1",
    "group": "global",
    "capabilities": ["luckperms", "cosmetics", "vote_rewards"]
  },
  "rewards": [
    {
      "id": "reward-row-uuid",
      "source": "store",
      "rewardKey": "store.realvip-monthly",
      "rewardType": "luckperms",
      "serverGroup": "global",
      "attempts": 1,
      "target": {
        "minecraftUuid": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "minecraftUsername": "PlayerName"
      },
      "entitlement": {
        "key": "product:realvip-monthly",
        "status": "active",
        "expiresAt": "2026-06-20T00:00:00.000Z"
      },
      "delivery": {
        "safeReward": true,
        "productSlug": "realvip-monthly",
        "voteSite": null,
        "quantity": 1,
        "durationDays": 30,
        "luckPerms": {
          "group": "realvip",
          "permission": null,
          "prefix": null,
          "suffix": null
        },
        "cosmetic": {
          "type": null,
          "key": "realvip-monthly",
          "lobbyOnly": false
        },
        "giftCard": {
          "valueCents": null
        }
      },
      "timing": {
        "availableAt": "2026-05-20T00:00:00.000Z",
        "processingAt": "2026-05-20T00:01:00.000Z",
        "claimedAt": "2026-05-20T00:01:00.000Z",
        "claimedByServer": "lobby-1"
      }
    }
  ]
}
```

Poll behavior:

- Returns only `pending` rows whose `available_at` has passed.
- Claims rows atomically using `for update skip locked`.
- Sets `status = processing`, `claimed_at`, `claimed_by_server`, and increments `attempts`.
- Returns minimal delivery data only. It does not expose email, user id, order id, payment id, or webhook data.

### Acknowledge Rewards

```text
POST /api/plugin/rewards/ack
```

Payload:

```json
{
  "serverId": "lobby-1",
  "deliveries": [
    {
      "rewardId": "reward-row-uuid",
      "status": "delivered"
    },
    {
      "rewardId": "failed-row-uuid",
      "status": "failed",
      "failureReason": "LuckPerms save failed"
    }
  ]
}
```

Response:

```json
{
  "accepted": true,
  "results": [
    {
      "rewardId": "reward-row-uuid",
      "accepted": true,
      "status": "delivered",
      "deliveredAt": "2026-05-20T00:02:00.000Z",
      "failedAt": null,
      "duplicate": false
    }
  ]
}
```

Ack behavior:

- Marks claimed rewards `delivered` or `failed`.
- Rejects rows claimed by another server.
- Repeated ack on already final rows is idempotent and returns `duplicate: true`.
- Failed rows keep `failure_reason` and `last_error` for support/admin review.

## Reward Delivery Model

Supported delivery families:

- LuckPerms groups: temporary and permanent parent grants.
- LuckPerms permissions: chat colors, particles, lobby flight, prefixes, suffixes.
- Cosmetic unlocks: pets, particles, profile frames, lobby effects, badges.
- Vote rewards: safe vote keys, profile points, streak progress, lobby-safe effects.
- Gift cards: generated store credit rewards, not raw card data.

RealCore must validate `rewardKey`, `rewardType`, and `delivery.safeReward` against an allowlist before executing anything.

Each reward carries `delivery.action`, which is `grant` or `revoke`. A `revoke`
reward (from a refund or chargeback) instructs RealCore to undo the matching
grant — remove the LuckPerms group/permission or lock the cosmetic — using the
same `productSlug` / `luckPerms` / `cosmetic` fields. Revokes are best-effort and
idempotent: removing a perk the player no longer has is a no-op.

## Entitlement Lifecycle

Payment lifecycle:

1. Checkout creates a pending local order.
2. Stripe/PayPal webhook verifies payment.
3. `fulfill_paid_order` creates entitlements and reward queue rows exactly once.
4. RealCore polls the reward.
5. RealCore applies LuckPerms/cosmetic delivery.
6. RealCore acknowledges delivered or failed.

Entitlement states:

- `active`
- `expired`
- `revoked`
- `refunded`

Refunds and chargebacks are handled by `revoke_order`: the order and its
entitlements transition to refunded/revoked, undelivered grant rewards are
cancelled, and compensating revoke rewards (`delivery.action = "revoke"`) are
queued for RealCore. Entitlement and reward history is never deleted.

## Vote Reward Lifecycle

1. Vote sites send public vote traffic to Velocity NuVotifier.
2. `RealVoteBridge` receives the NuVotifier event on Velocity and forwards it to `/api/vote` with RealCore-style HMAC auth.
3. Vote log is persisted with idempotency.
4. Vote streaks update atomically via `apply_vote_streak`.
5. Safe vote reward is queued; a milestone reward is queued when monthly votes hit 5, 15, 30, or 75.
6. RealCore polls and delivers the vote and milestone rewards on the backend server.
7. RealCore acknowledges final status.

## Package Layout

```text
com.realfiction.realcore
  RealCorePlugin.java
  config/
    RealCoreConfig.java
  api/
    PlatformApiClient.java
    SignedRequestFactory.java
  linking/
    LinkCommand.java
    AccountLinkService.java
  rewards/
    RewardPoller.java
    RewardExecutor.java
    RewardAckService.java
    RewardType.java
  luckperms/
    LuckPermsService.java
    RankGrant.java
  cosmetics/
    CosmeticService.java
    PetService.java
    ParticleService.java
    ChatColorService.java
    LobbyFlightService.java
  votes/
    VoteRewardService.java
    VoteStreakService.java
  profile/
    PlayerProfileSyncService.java
  scheduling/
    FoliaSchedulerAdapter.java
    PaperSchedulerAdapter.java
  audit/
    AuditEventPublisher.java
```

## Account Link Flow

1. Player signs in on the website and starts a link request.
2. Website returns `/realfiction link CODE`.
3. Player runs the command in-game.
4. Plugin resolves the command sender UUID and current username.
5. Plugin calls `/api/plugin/account-link/confirm` with the code, UUID, username, platform, and plugin auth.
6. Website finalizes the pending link if the code is valid and unexpired.

The plugin must not trust user-supplied UUIDs from chat or command arguments. It should always use the authenticated command sender.

## LuckPerms Grants

Timed RealVIP:

```text
parent addtemp realvip 30d
```

Permanent RealSupporter:

```text
parent add realsupporter
```

Chat color:

```text
permission set realfiction.chat.color.aqua
```

Lobby flight:

```text
permission set realfiction.lobby.flight
```

## Async And Folia Rules

- Network calls never run on a region thread.
- SQL calls never run on a region thread.
- Global state updates use a scheduler abstraction.
- Player inventory, teleport, velocity, and entity operations use the player scheduler.
- LuckPerms API calls should use async user loading and saving.
- Reward delivery must be idempotent and retry-safe.

## Failure Handling

- Failed reward rows keep attempt metadata.
- Retry should use `available_at` and exponential backoff in a future retry worker.
- Poisoned rows remain visible for admin/support review.
- Admin tooling should replay only rewards marked safe.
- Every grant, revoke, expiration, and failure should eventually write an audit event.

## No Pay-To-Win Enforcement

RealCore must treat website payloads as instructions from a trusted backend, but still validate that product and reward keys are from an allowlist. Store rewards are limited to supporter identity, cosmetics, pets, particles, chat colors, lobby flight, visual effects, gift cards, and profile/lobby customization.

RealCore must not implement paid combat kits, economy multipliers, claim advantages, PvP advantages, or server-balance advantages.
