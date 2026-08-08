import { z } from "zod"

import { constantTimeEqual, describeError, safeJsonError } from "@/lib/security"
import { requireStaff } from "@/lib/auth/staff"
import { callServiceRoleRpc } from "@/lib/supabase/service-role-rest"

const MISSING_SCHEMA_CODES = new Set(["42883", "42P01", "42704"])

const CURRENCY_PATTERN = /^[a-z0-9_.-]{2,80}$/i
const MINECRAFT_ID_PATTERN = /^[A-Za-z0-9_.:-]{8,48}$/
const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,32}$/
const INTEGER_MINOR_PATTERN = /^\d+$/

const metadataSchema = z.record(z.string(), z.unknown()).default({})

const minorUnitSchema = z.union([
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  z.string().trim().regex(INTEGER_MINOR_PATTERN)
]).transform((value) => String(value))

const importEntrySchema = z.object({
  minecraftUuid: z.string().trim().regex(MINECRAFT_ID_PATTERN, "minecraftUuid shape"),
  minecraftUsername: z.string().trim().regex(USERNAME_PATTERN, "minecraftUsername shape").optional(),
  targetBalanceMinor: minorUnitSchema,
  metadata: metadataSchema
})

const importBodySchema = z.object({
  operation: z.literal("import").default("import"),
  currencyKey: z.string().trim().toLowerCase().regex(CURRENCY_PATTERN).default("realfiction_main"),
  importBatchId: z.string().uuid(),
  reason: z.string().trim().min(3).max(240),
  dryRun: z.boolean().default(true),
  entries: z.array(importEntrySchema).min(1).max(5000),
  metadata: metadataSchema
})

const rollbackBodySchema = z.object({
  operation: z.literal("rollback"),
  currencyKey: z.string().trim().toLowerCase().regex(CURRENCY_PATTERN).default("realfiction_main"),
  originalImportBatchId: z.string().uuid(),
  rollbackBatchId: z.string().uuid(),
  reason: z.string().trim().min(3).max(240),
  dryRun: z.boolean().default(true),
  metadata: metadataSchema
}).refine((body) => body.originalImportBatchId !== body.rollbackBatchId, {
  message: "rollbackBatchId must differ from originalImportBatchId",
  path: ["rollbackBatchId"]
})

type ImportActor =
  | { ok: true; actorType: "admin" | "service"; actorId: string; adminUserId: string | null }
  | { ok: false; response: Response }

type ImportRow = {
  minecraft_uuid?: string
  minecraft_username?: string | null
  previous_balance_minor?: number | string | null
  target_balance_minor?: number | string | null
  delta_minor?: number | string | null
  ledger_id?: string | null
  duplicate?: boolean
  dry_run?: boolean
}

type RollbackRow = {
  original_ledger_id?: string
  minecraft_uuid?: string
  minecraft_username?: string | null
  previous_balance_minor?: number | string | null
  rollback_amount_minor?: number | string | null
  new_balance_minor?: number | string | null
  rollback_ledger_id?: string | null
  duplicate?: boolean
  dry_run?: boolean
}

async function authorizeImport(request: Request): Promise<ImportActor> {
  const providedServiceSecret = request.headers.get("x-realfiction-economy-import-secret")

  if (providedServiceSecret) {
    const expectedServiceSecret = process.env.ECONOMY_IMPORT_SERVICE_SECRET

    if (!expectedServiceSecret) {
      return { ok: false, response: safeJsonError("Economy import service authorization is not configured.", 503) }
    }

    if (!constantTimeEqual(providedServiceSecret, expectedServiceSecret)) {
      return { ok: false, response: Response.json({ error: "Unauthorized." }, { status: 401 }) }
    }

    return {
      ok: true,
      actorType: "service",
      actorId: request.headers.get("x-realfiction-import-actor")?.trim() || "economy-import-service",
      adminUserId: null
    }
  }

  // A REAL staff check, against the database, for the caller's own session.
  //
  // This previously accepted any authenticated account as "admin": it called
  // getAuthenticatedUser() and, if anyone was signed in, returned
  // actorType "admin". The route then invoked admin_import_economy_balances
  // through the SERVICE ROLE, which bypasses RLS — and the SQL side validates
  // only the SHAPE of these audit fields (`_economy_assert_import_actor`
  // checks actor_type is 'admin'|'service' and that an admin id is present),
  // never that the caller holds the role. Anyone who could register could mint
  // arbitrary economy balances.
  //
  // `actorType`/`actorId` remain AUDIT values. They are derived from the
  // verified session here and are never read from the request body.
  const staff = await requireStaff()

  if (!staff.ok) {
    if (staff.reason === "unavailable") {
      // Fail closed. An unreachable database is not permission.
      return { ok: false, response: safeJsonError("We could not verify your access.", 503) }
    }
    // Signed-out and not-staff answer identically, so this cannot be used to
    // discover who holds the role.
    return { ok: false, response: Response.json({ error: "Unauthorized." }, { status: 401 }) }
  }

  return {
    ok: true,
    actorType: "admin",
    actorId: staff.userId,
    adminUserId: staff.userId
  }
}

function summarizeImport(rows: ImportRow[]) {
  return {
    rows: rows.length,
    duplicates: rows.filter((row) => Boolean(row.duplicate)).length,
    changed: rows.filter((row) => !row.duplicate && row.ledger_id).length,
    unchanged: rows.filter((row) => !row.duplicate && !row.ledger_id).length,
    totalDeltaMinor: rows.reduce((sum, row) => sum + Number(row.delta_minor ?? 0), 0)
  }
}

function summarizeRollback(rows: RollbackRow[]) {
  return {
    rows: rows.length,
    duplicates: rows.filter((row) => Boolean(row.duplicate)).length,
    changed: rows.filter((row) => !row.duplicate && row.rollback_ledger_id).length,
    totalDeltaMinor: rows.reduce((sum, row) => sum + Number(row.rollback_amount_minor ?? 0), 0)
  }
}

function rpcStatus(error: { code?: string; status: number }) {
  if (error.code && MISSING_SCHEMA_CODES.has(error.code)) {
    return 503
  }

  return error.status >= 400 && error.status < 500 ? 400 : 500
}

export async function POST(request: Request) {
  try {
    const actor = await authorizeImport(request)

    if (!actor.ok) {
      return actor.response
    }

    const body = await request.json().catch(() => null)
    const operation = body && typeof body === "object" && "operation" in body ? (body as { operation?: unknown }).operation : "import"

    if (operation === "rollback") {
      const parsed = rollbackBodySchema.safeParse(body)

      if (!parsed.success) {
        return Response.json({ error: "Invalid economy rollback payload." }, { status: 400 })
      }

      const { data, error } = await callServiceRoleRpc<RollbackRow[] | null>("admin_rollback_economy_import", {
        p_actor_type: actor.actorType,
        p_actor_id: actor.actorId,
        p_admin_user_id: actor.adminUserId,
        p_currency_key: parsed.data.currencyKey,
        p_original_import_batch_id: parsed.data.originalImportBatchId,
        p_rollback_batch_id: parsed.data.rollbackBatchId,
        p_reason: parsed.data.reason,
        p_dry_run: parsed.data.dryRun,
        p_metadata: parsed.data.metadata
      })

      if (error) {
        console.error("admin_economy_import_rollback_rpc", describeError(error))
        const status = rpcStatus(error)
        return safeJsonError(status === 503 ? "Economy import is not configured." : "Economy rollback was rejected.", status)
      }

      const rows = data ?? []

      return Response.json({
        ok: true,
        operation: "rollback",
        dryRun: parsed.data.dryRun,
        currencyKey: parsed.data.currencyKey,
        originalImportBatchId: parsed.data.originalImportBatchId,
        rollbackBatchId: parsed.data.rollbackBatchId,
        summary: summarizeRollback(rows),
        rows,
        scale: 100
      })
    }

    const parsed = importBodySchema.safeParse(body)

    if (!parsed.success) {
      return Response.json({ error: "Invalid economy import payload." }, { status: 400 })
    }

    const { data, error } = await callServiceRoleRpc<ImportRow[] | null>("admin_import_economy_balances", {
      p_actor_type: actor.actorType,
      p_actor_id: actor.actorId,
      p_admin_user_id: actor.adminUserId,
      p_currency_key: parsed.data.currencyKey,
      p_import_batch_id: parsed.data.importBatchId,
      p_reason: parsed.data.reason,
      p_dry_run: parsed.data.dryRun,
      p_entries: parsed.data.entries.map((entry) => ({
        minecraftUuid: entry.minecraftUuid,
        minecraftUsername: entry.minecraftUsername ?? null,
        targetBalanceMinor: entry.targetBalanceMinor,
        metadata: entry.metadata
      })),
      p_metadata: parsed.data.metadata
    })

    if (error) {
      console.error("admin_economy_import_rpc", describeError(error))
      const status = rpcStatus(error)
      return safeJsonError(status === 503 ? "Economy import is not configured." : "Economy import was rejected.", status)
    }

    const rows = data ?? []

    return Response.json({
      ok: true,
      operation: "import",
      dryRun: parsed.data.dryRun,
      currencyKey: parsed.data.currencyKey,
      importBatchId: parsed.data.importBatchId,
      summary: summarizeImport(rows),
      rows,
      scale: 100
    })
  } catch (error) {
    console.error("admin_economy_import_error", describeError(error))
    return safeJsonError("Economy import could not be processed.", 500)
  }
}
