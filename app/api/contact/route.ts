import { z } from "zod"

import { safeJsonError, sha256Hex } from "@/lib/security"
import { getAuthenticatedUser } from "@/lib/supabase/server"
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role"

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
    // Tell the sender which field to fix instead of a single opaque rejection,
    // while keeping the response free of internal/validation-library detail.
    const field = parsed.error.issues[0]?.path[0]
    const fieldMessages: Record<string, string> = {
      name: "Please enter your name (2–80 characters).",
      email: "Please enter a valid email address so we can reply.",
      minecraftUsername: "That Minecraft username is too long (max 16 characters).",
      topic: "Please add a short topic (at least 3 characters).",
      message: "Please add a little more detail — your message needs at least 10 characters."
    }
    const error =
      (typeof field === "string" && fieldMessages[field]) ||
      "Please double-check the form and try again."
    return Response.json({ error }, { status: 400 })
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
