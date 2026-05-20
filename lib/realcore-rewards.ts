import "server-only"

type JsonRecord = Record<string, unknown>

export type RewardQueueRow = {
  reward_id: string
  source: string
  reward_key: string
  minecraft_uuid: string | null
  minecraft_username: string | null
  server_group: string
  attempts: number
  payload: JsonRecord | null
  entitlement_key: string | null
  entitlement_expires_at: string | null
  entitlement_status: string | null
  available_at: string
  processing_at: string | null
  claimed_at: string | null
  claimed_by_server: string | null
}

function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord
  }

  return {}
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null
}

function inferRewardType(row: RewardQueueRow, payload: JsonRecord, metadata: JsonRecord) {
  if (stringValue(payload.action) === "revoke") {
    return "revoke"
  }

  if (row.source === "vote") {
    return "vote"
  }

  if (stringValue(metadata.luckperms_group) || stringValue(metadata.luckperms_permission)) {
    return "luckperms"
  }

  if (stringValue(metadata.cosmetic_type)) {
    return "cosmetic"
  }

  if (booleanValue(metadata.lobby_only)) {
    return "lobby"
  }

  if (numberValue(metadata.gift_card_value_cents)) {
    return "gift_card"
  }

  return stringValue(payload.reward_type) ?? "generic"
}

export function formatRealCoreReward(row: RewardQueueRow) {
  const payload = asRecord(row.payload)
  const metadata = asRecord(payload.metadata)
  const rewardType = inferRewardType(row, payload, metadata)
  const durationDays = numberValue(payload.duration_days) ?? numberValue(metadata.duration_days)

  return {
    id: row.reward_id,
    source: row.source,
    rewardKey: row.reward_key,
    rewardType,
    serverGroup: row.server_group,
    attempts: row.attempts,
    target: {
      minecraftUuid: row.minecraft_uuid,
      minecraftUsername: row.minecraft_username
    },
    entitlement: {
      key: row.entitlement_key,
      status: row.entitlement_status,
      expiresAt: row.entitlement_expires_at
    },
    delivery: {
      action: stringValue(payload.action) === "revoke" ? "revoke" : "grant",
      safeReward: payload.safe_reward === true || metadata.safe_reward === true,
      productSlug: stringValue(payload.product_slug),
      voteSite: stringValue(payload.vote_site),
      quantity: numberValue(payload.quantity) ?? 1,
      durationDays,
      luckPerms: {
        group: stringValue(metadata.luckperms_group),
        permission: stringValue(metadata.luckperms_permission),
        prefix: stringValue(metadata.luckperms_prefix),
        suffix: stringValue(metadata.luckperms_suffix)
      },
      cosmetic: {
        type: stringValue(metadata.cosmetic_type),
        key: stringValue(payload.product_slug) ?? stringValue(payload.cosmetic_key) ?? row.reward_key,
        lobbyOnly: metadata.lobby_only === true
      },
      giftCard: {
        valueCents: numberValue(metadata.gift_card_value_cents)
      }
    },
    timing: {
      availableAt: row.available_at,
      processingAt: row.processing_at,
      claimedAt: row.claimed_at,
      claimedByServer: row.claimed_by_server
    }
  }
}
