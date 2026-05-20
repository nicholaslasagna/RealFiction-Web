import { z } from "zod"

import { confirmMinecraftAccountLink } from "@/lib/account-link-server"
import { parsePluginJson, requirePluginAuth } from "@/lib/plugin-auth"
import { safeJsonError } from "@/lib/security"

export const runtime = "edge"

const confirmSchema = z.object({
  serverId: z.string().trim().min(2).max(80).optional(),
  verificationCode: z.string().trim().min(6).max(32),
  minecraftUuid: z.string().trim().min(32).max(36),
  minecraftUsername: z.string().trim().min(3).max(16).regex(/^[A-Za-z0-9_]+$/),
  platform: z.enum(["java", "bedrock"]).default("java")
})

export async function POST(request: Request) {
  const rawBody = await request.text()
  const auth = await requirePluginAuth(request, rawBody, "account-link.confirm")

  if (!auth.ok) {
    return auth.response
  }

  const parsed = confirmSchema.safeParse(parsePluginJson(rawBody))

  if (!parsed.success) {
    return Response.json({ error: "Invalid account link confirmation payload." }, { status: 400 })
  }

  if (auth.mode === "hmac" && parsed.data.serverId && parsed.data.serverId !== auth.serverId) {
    return Response.json({ error: "Plugin server identity mismatch." }, { status: 401 })
  }

  try {
    const confirmed = await confirmMinecraftAccountLink(parsed.data)

    if (!confirmed) {
      return Response.json({ error: "Verification code is invalid or expired." }, { status: 404 })
    }

    return Response.json({
      confirmed: true,
      link: {
        minecraftUuid: confirmed.minecraftUuid,
        minecraftUsername: confirmed.minecraftUsername,
        platform: confirmed.platform
      }
    })
  } catch (error) {
    console.error("plugin_account_link_confirm_error", error)
    return safeJsonError("Could not confirm Minecraft account link.", 500)
  }
}
