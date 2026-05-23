import { z } from "zod"

import { parsePluginJson, requirePluginAuth } from "@/lib/plugin-auth"
import { describeError, safeJsonError } from "@/lib/security"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

// Stat keys this route is allowed to write. playtime.* is intentionally NOT
// here: playtime is owned by /api/plugin/playtime/session via the
// apply_playtime_events RPC and mirrored into network_stat_totals server-side.
// Letting the generic events route also touch playtime.* would let a leaked
// plugin secret rewrite authoritative session totals, so we block it at the
// API boundary even though the SQL upsert technically accepts any key.
//
// To add a new stat family (e.g. "crates."), add the prefix here, in the
// public allowlist (if it should be exposed), and ship a new RealCore
// producer. No DB changes required.
const WRITABLE_STAT_PREFIXES = [
  "kills.",
  "deaths.",
  "blocks_broken.",
  "votes.",
  "money."
] as const

const STAT_KEY_PATTERN = /^[a-z0-9_.-]{2,80}$/i
const SUBJECT_TYPE_PATTERN = /^[a-z]{2,32}$/
const SUBJECT_ID_PATTERN = /^[A-Za-z0-9_.\-:]{2,128}$/

const eventSchema = z
  .object({
    statKey: z
      .string()
      .trim()
      .toLowerCase()
      .regex(STAT_KEY_PATTERN, "statKey shape")
      .refine(
        (key) => WRITABLE_STAT_PREFIXES.some((prefix) => key.startsWith(prefix)),
        "statKey not writable from this route"
      ),
    subjectType: z.string().trim().toLowerCase().regex(SUBJECT_TYPE_PATTERN).default("player"),
    subjectId: z.string().trim().regex(SUBJECT_ID_PATTERN, "subjectId shape"),
    displayName: z.string().trim().min(1).max(64).optional(),
    // Single numeric channel for both modes. For 'set' it's the absolute value
    // and may go down (e.g. economy mirror reflects a balance decrease). For
    // 'increment' it's a delta and is clamped to >= 0 below so a buggy producer
    // can never debit from a counter. Bounded on both ends so a typo or
    // wrap-around can't blow up the total.
    value: z
      .number()
      .finite()
      .gte(-1_000_000_000_000)
      .lte(1_000_000_000_000),
    mode: z.enum(["increment", "set"]).default("increment")
  })
  .refine((event) => event.mode !== "increment" || event.value >= 0, {
    message: "increment delta must be >= 0",
    path: ["value"]
  })

const eventsSchema = z.object({
  serverId: z.string().trim().min(2).max(80),
  batchId: z.string().uuid(),
  events: z.array(eventSchema).min(1).max(500)
})

type ApplyResult = {
  applied_count?: number
  duplicate?: boolean
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const auth = await requirePluginAuth(request, rawBody, "stats.events")

    if (!auth.ok) {
      return auth.response
    }

    const parsed = eventsSchema.safeParse(parsePluginJson(rawBody))

    if (!parsed.success) {
      return Response.json({ error: "Invalid stat events payload." }, { status: 400 })
    }

    if (auth.mode === "hmac" && parsed.data.serverId !== auth.serverId) {
      return Response.json({ error: "Plugin server identity mismatch." }, { status: 401 })
    }

    const { data, error } = await callServiceRoleRpc<ApplyResult[] | ApplyResult | null>(
      "apply_network_stat_events",
      {
        p_server_id: parsed.data.serverId,
        p_batch_id: parsed.data.batchId,
        p_events: parsed.data.events.map((event) => ({
          statKey: event.statKey,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          displayName: event.displayName ?? null,
          value: event.value,
          mode: event.mode
        }))
      }
    )

    if (error) {
      console.error("plugin_stats_events_rpc", describeError(error))
      const status = error.code && MISSING_SCHEMA_CODES.has(error.code) ? 503 : 500
      return safeJsonError("Stat events could not be applied.", status)
    }

    const summary = Array.isArray(data) ? data[0] : data
    const applied = Number.isFinite(summary?.applied_count) ? Number(summary?.applied_count) : 0
    const duplicate = Boolean(summary?.duplicate)

    return Response.json({
      ok: true,
      applied,
      duplicate,
      submitted: parsed.data.events.length,
      batchId: parsed.data.batchId
    })
  } catch (error) {
    console.error("plugin_stats_events_error", describeError(error))
    return safeJsonError("Stat events could not be applied.", 500)
  }
}
