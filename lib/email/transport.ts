// THE canonical Resend transport.
//
// `sendProviderEmail` is the ONLY function in production that calls
// api.resend.com. The scheduled processor calls it; nothing else does. Keeping
// one implementation means the request shape that tests assert is literally the
// request shape production sends.
//
// No "server-only" import and no ambient config: everything is passed in, so the
// exact production function is unit-testable and works inside a Cloudflare
// `scheduled()` handler where `process.env` is not populated.

import { classifyProviderStatus, diagnosticCategory, parseRetryAfter } from "./queue"

export const RESEND_ENDPOINT = "https://api.resend.com/emails"

/** Bounded dispatch. Past this we cannot prove acceptance, so it is ambiguous. */
export const PROVIDER_TIMEOUT_MS = 15_000

export type EmailTransportConfig = {
  apiKey: string
  from: string
  replyTo: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html: string
  /** Deterministic delivery key — the provider-side duplicate suppressor. */
  idempotencyKey: string
}

export type TransportResult =
  | { kind: "accepted"; status: number; providerMessageId: string | null }
  | { kind: "retryable"; status: number | null; category: string; error: string; retryAfterSeconds: number | null }
  | { kind: "permanent"; status: number; category: string; error: string }
  /**
   * Dispatched, but acceptance could not be determined — a timeout after the
   * request went out, or a connection closed with no definitive response.
   * Retrying with the SAME key inside the provider window is the safe response.
   */
  | { kind: "ambiguous"; category: string; error: string }

/** Exact production request body. Asserted directly by the transport tests. */
export function buildResendPayload(message: EmailMessage, config: EmailTransportConfig) {
  return {
    from: config.from,
    to: [message.to],
    subject: message.subject,
    text: message.text,
    html: message.html,
    reply_to: config.replyTo
  }
}

/** Exact production request headers. */
export function buildResendHeaders(message: EmailMessage, config: EmailTransportConfig) {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    "Idempotency-Key": message.idempotencyKey
  }
}

/**
 * Sends one message. Never throws.
 *
 * Nothing here logs: not the Authorization header, the API key, the recipient,
 * the provider response body, or the rendered HTML. The caller records only a
 * status code and a short category.
 */
export async function sendProviderEmail(
  message: EmailMessage,
  config: EmailTransportConfig
): Promise<TransportResult> {
  const fetchImpl = config.fetchImpl ?? fetch
  const timeoutMs = config.timeoutMs ?? PROVIDER_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: buildResendHeaders(message, config),
      body: JSON.stringify(buildResendPayload(message, config)),
      signal: controller.signal
    })

    let providerMessageId: string | null = null
    let errorName = "unknown"
    let malformed = false

    try {
      const body = (await response.json()) as { id?: string; name?: string }
      providerMessageId = typeof body?.id === "string" ? body.id : null
      errorName = typeof body?.name === "string" ? body.name : errorName
    } catch {
      malformed = true
    }

    if (response.status >= 200 && response.status < 300) {
      // A 2xx with an unreadable body still means accepted — treat it as sent
      // (with no message id) rather than resending and risking a duplicate.
      return { kind: "accepted", status: response.status, providerMessageId }
    }

    const category = diagnosticCategory(response.status)
    const error = `resend_${response.status}_${malformed ? "malformed_body" : errorName}`.slice(0, 200)

    return classifyProviderStatus(response.status) === "retry"
      ? {
          kind: "retryable",
          status: response.status,
          category,
          error,
          retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after"))
        }
      : { kind: "permanent", status: response.status, category, error }
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown"

    // An abort means the request was already dispatched and we stopped waiting;
    // Resend may or may not have accepted it. Same for a connection closed
    // mid-flight. Neither can be called a failure.
    if (name === "AbortError" || name === "TimeoutError") {
      return { kind: "ambiguous", category: "dispatch_timeout", error: "dispatch_timeout" }
    }

    return {
      kind: "ambiguous",
      category: "connection_closed",
      error: `transport_${name}`.slice(0, 200)
    }
  } finally {
    clearTimeout(timer)
  }
}
