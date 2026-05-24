import { z } from "zod"

import { parsePluginJson, requirePluginAuth } from "@/lib/plugin-auth"
import { describeError, safeJsonError } from "@/lib/security"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

const balanceSchema = z.object({
  serverId: z.string().trim().min(2).max(80),
  serverGroup: z.string().trim().min(2).max(80),
  currencyKey: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{2,80}$/i).default("realfiction_main"),
  minecraftUuid: z.string().trim().regex(/^[A-Za-z0-9_.:-]{8,48}$/, "minecraftUuid shape")
})

type BalanceResult = {
  currency_key?: string
  minecraft_uuid?: string
  minecraft_username?: string | null
  balance_minor?: number | string
  updated_at?: string | null
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const auth = await requirePluginAuth(request, rawBody, "economy.balance")

    if (!auth.ok) {
      return auth.response
    }

    const parsed = balanceSchema.safeParse(parsePluginJson(rawBody))

    if (!parsed.success) {
      return Response.json({ error: "Invalid economy balance payload." }, { status: 400 })
    }

    if (auth.mode === "hmac" && parsed.data.serverId !== auth.serverId) {
      return Response.json({ error: "Plugin server identity mismatch." }, { status: 401 })
    }

    const { data, error } = await callServiceRoleRpc<BalanceResult[] | BalanceResult | null>("get_plugin_economy_balance", {
      p_server_id: parsed.data.serverId,
      p_server_group: parsed.data.serverGroup,
      p_currency_key: parsed.data.currencyKey,
      p_minecraft_uuid: parsed.data.minecraftUuid
    })

    if (error) {
      console.error("plugin_economy_balance_rpc", describeError(error))
      const status = error.code && MISSING_SCHEMA_CODES.has(error.code) ? 503 : error.status >= 400 && error.status < 500 ? 400 : 500
      return safeJsonError(status === 503 ? "Economy is not configured." : "Economy balance could not be loaded.", status)
    }

    const row = Array.isArray(data) ? data[0] : data

    return Response.json({
      currencyKey: row?.currency_key ?? parsed.data.currencyKey,
      minecraftUuid: row?.minecraft_uuid ?? parsed.data.minecraftUuid,
      minecraftUsername: row?.minecraft_username ?? null,
      balanceMinor: Number(row?.balance_minor ?? 0),
      scale: 100,
      updatedAt: row?.updated_at ?? null
    })
  } catch (error) {
    console.error("plugin_economy_balance_error", describeError(error))
    return safeJsonError("Economy balance could not be loaded.", 500)
  }
}
