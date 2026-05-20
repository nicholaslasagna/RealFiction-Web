import { z } from "zod"

export const runtime = "edge"

const contactSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  minecraftUsername: z.string().trim().max(16).optional().or(z.literal("")),
  topic: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(4000)
})

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = contactSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json({ error: "Invalid support request." }, { status: 400 })
  }

  // In production this route should insert a support_tickets row with the
  // authenticated user id when available, then send notifications through a
  // ticket system, Discord webhook, or email provider.
  return Response.json({
    message: "Support request received. Ticket persistence is ready for Supabase configuration.",
    ticketPreview: {
      topic: parsed.data.topic,
      minecraftUsername: parsed.data.minecraftUsername || null
    }
  })
}
