import { z } from "zod"

import { safeJsonError, sha256Hex } from "@/lib/security"
import { getAuthenticatedUser } from "@/lib/supabase/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

export const runtime = "edge"

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX = 5

const contactSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  minecraftUsername: z.string().trim().max(16).optional().or(z.literal("")),
  topic: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(4000),
  // Honeypot: real users leave this empty; bots tend to fill every field.
  website: z.string().max(200).optional()
})

function getClientIp(request: Request) {
  const cfIp = request.headers.get("cf-connecting-ip")
  if (cfIp) {
    return cfIp
  }

  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown"
  }

  return "unknown"
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = contactSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json({ error: "Invalid support request." }, { status: 400 })
  }

  // Silently accept honeypot hits so bots cannot distinguish a drop from success.
  if (parsed.data.website && parsed.data.website.trim().length > 0) {
    return Response.json({ message: "Support request received." })
  }

  try {
    const supabase = getSupabaseServiceRoleClient()
    const ipHash = await sha256Hex(`contact:${getClientIp(request)}`)
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()

    const { count, error: countError } = await supabase
      .from("support_tickets")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since)

    if (countError) {
      throw new Error("Could not check support request rate.")
    }

    if ((count ?? 0) >= RATE_LIMIT_MAX) {
      return Response.json(
        { error: "Too many support requests. Please wait a few minutes and try again." },
        { status: 429 }
      )
    }

    const user = await getAuthenticatedUser().catch(() => null)

    const { data: ticket, error } = await supabase
      .from("support_tickets")
      .insert({
        user_id: user?.id ?? null,
        email: parsed.data.email,
        minecraft_username: parsed.data.minecraftUsername?.trim() || null,
        topic: parsed.data.topic,
        message: parsed.data.message,
        ip_hash: ipHash,
        metadata: { source: "contact_form", name: parsed.data.name }
      })
      .select("id")
      .single()

    if (error || !ticket) {
      throw new Error("Could not record support request.")
    }

    return Response.json({
      message: "Support request received. Our team will follow up by email.",
      ticketId: ticket.id
    })
  } catch (error) {
    console.error("contact_error", error)
    return safeJsonError("Support request could not be processed right now.", 500)
  }
}
