import { z } from "zod"

import { parsePluginJson, requirePluginAuth } from "@/lib/plugin-auth"
import { describeError, safeJsonError } from "@/lib/security"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

const CURRENCY_PATTERN = /^[a-z0-9_.-]{2,80}$/i
const ID_PATTERN = /^[A-Za-z0-9_.:\-/]{2,180}$/
const MINECRAFT_ID_PATTERN = /^[A-Za-z0-9_.:-]{8,48}$/
const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,32}$/

const pluginCategorySchema = z.enum(["vote_reward", "gameplay_earn", "spend"])

const transactionSchema = z.object({
  minecraftUuid: z.string().trim().regex(MINECRAFT_ID_PATTERN, "minecraftUuid shape"),
  minecraftUsername: z.string().trim().regex(USERNAME_PATTERN, "minecraftUsername shape").optional(),
  amountMinor: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000),
  category: pluginCategorySchema,
  reason: z.string().trim().min(2).max(180),
  idempotencyKey: z.string().trim().regex(ID_PATTERN, "idempotencyKey shape"),
  externalRefType: z.string().trim().regex(ID_PATTERN, "externalRefType shape").optional(),
  externalRefId: z.string().trim().regex(ID_PATTERN, "externalRefId shape").optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
}).refine((tx) => tx.amountMinor !== 0, {
  message: "amountMinor must be non-zero",
  path: ["amountMinor"]
})

const batchSchema = z.object({
  serverId: z.string().trim().min(2).max(80),
  serverGroup: z.string().trim().min(2).max(80),
  currencyKey: z.string().trim().toLowerCase().regex(CURRENCY_PATTERN).default("realfiction_main"),
  batchId: z.string().uuid(),
  transactions: z.array(transactionSchema).min(1).max(500)
})

type BatchResult = {
  batch_id?: string
  submitted_count?: number
  applied_count?: number
  duplicate_count?: number
  duplicate_batch?: boolean
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const auth = await requirePluginAuth(request, rawBody, "economy.transactions")

    if (!auth.ok) {
      return auth.response
    }

    const parsed = batchSchema.safeParse(parsePluginJson(rawBody))

    if (!parsed.success) {
      return Response.json({ error: "Invalid economy transaction payload." }, { status: 400 })
    }

    if (auth.mode === "hmac" && parsed.data.serverId !== auth.serverId) {
      return Response.json({ error: "Plugin server identity mismatch." }, { status: 401 })
    }

    const { data, error } = await callServiceRoleRpc<BatchResult[] | BatchResult | null>("apply_economy_batch", {
      p_server_id: parsed.data.serverId,
      p_server_group: parsed.data.serverGroup,
      p_currency_key: parsed.data.currencyKey,
      p_batch_id: parsed.data.batchId,
      p_transactions: parsed.data.transactions.map((transaction) => ({
        minecraftUuid: transaction.minecraftUuid,
        minecraftUsername: transaction.minecraftUsername ?? null,
        amountMinor: transaction.amountMinor,
        category: transaction.category,
        reason: transaction.reason,
        idempotencyKey: transaction.idempotencyKey,
        externalRefType: transaction.externalRefType ?? null,
        externalRefId: transaction.externalRefId ?? null,
        metadata: transaction.metadata
      }))
    })

    if (error) {
      console.error("plugin_economy_transactions_rpc", describeError(error))
      const status = error.code && MISSING_SCHEMA_CODES.has(error.code) ? 503 : error.status >= 400 && error.status < 500 ? 400 : 500
      return safeJsonError(status === 503 ? "Economy is not configured." : "Economy transactions could not be applied.", status)
    }

    const summary = Array.isArray(data) ? data[0] : data

    return Response.json({
      ok: true,
      currencyKey: parsed.data.currencyKey,
      batchId: summary?.batch_id ?? parsed.data.batchId,
      submitted: Number(summary?.submitted_count ?? parsed.data.transactions.length),
      applied: Number(summary?.applied_count ?? 0),
      duplicates: Number(summary?.duplicate_count ?? 0),
      duplicateBatch: Boolean(summary?.duplicate_batch),
      scale: 100
    })
  } catch (error) {
    console.error("plugin_economy_transactions_error", describeError(error))
    return safeJsonError("Economy transactions could not be applied.", 500)
  }
}
