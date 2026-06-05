// Best-effort Discord notification for contact-form submissions.
//
// The support ticket is always persisted first; this only *notifies* a private
// Discord channel so the team sees new requests without polling the database.
// It never throws, never blocks the request meaningfully (5s timeout), and
// never logs or returns the webhook URL.

export interface ContactNotifyInput {
  name: string
  email: string
  minecraftUsername?: string | null
  topic: string
  message: string
}

export interface ContactNotifyResult {
  delivered: boolean
  status?: number
  skipped?: boolean
}

// Discord embed limits (with headroom): title 256, description 4096, value 1024.
const TITLE_MAX = 256
const DESCRIPTION_MAX = 3900
const FIELD_MAX = 256
const FOOTER_MAX = 2048

function clip(value: string, max: number): string {
  const v = (value ?? "").trim()
  return v.length <= max ? v : `${v.slice(0, max - 1)}…`
}

/**
 * Build the Discord webhook JSON for a contact submission. Pure and
 * deterministic (no env, no clock, no network) so it can be unit-tested.
 *
 * Mentions are always disabled via {@code allowed_mentions}, so even a message
 * containing `@everyone`/`@here`/`<@id>` is shown as plain text and pings nobody
 * — no need to mangle the user's content.
 */
export function buildContactDiscordPayload(input: ContactNotifyInput, ticketId: string) {
  const minecraft = (input.minecraftUsername ?? "").trim()
  return {
    username: "RealFiction Contact",
    embeds: [
      {
        title: clip(`New support request: ${input.topic}`, TITLE_MAX),
        description: clip(input.message, DESCRIPTION_MAX),
        color: 0xf5a623,
        fields: [
          { name: "Name", value: clip(input.name || "—", FIELD_MAX), inline: true },
          { name: "Email", value: clip(input.email || "—", FIELD_MAX), inline: true },
          { name: "Minecraft", value: clip(minecraft || "—", FIELD_MAX), inline: true }
        ],
        footer: { text: clip(`Ticket ${ticketId} · realfiction.live`, FOOTER_MAX) }
      }
    ],
    allowed_mentions: { parse: [] as string[] }
  }
}

export function contactWebhookUrl(): string {
  return (process.env.DISCORD_CONTACT_WEBHOOK_URL ?? "").trim()
}

export function isContactWebhookConfigured(): boolean {
  return contactWebhookUrl().length > 0
}

/**
 * Post a submission to the configured Discord channel. Best-effort: returns a
 * result object and never throws. When no webhook is configured it returns
 * {@code skipped: true} so callers can stay quiet. The URL is never logged.
 */
export async function notifyContactWebhook(
  input: ContactNotifyInput,
  ticketId: string
): Promise<ContactNotifyResult> {
  const url = contactWebhookUrl()
  if (!url) {
    return { delivered: false, skipped: true }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildContactDiscordPayload(input, ticketId)),
      signal: controller.signal
    })
    return { delivered: response.ok, status: response.status }
  } catch {
    return { delivered: false }
  } finally {
    clearTimeout(timeout)
  }
}
