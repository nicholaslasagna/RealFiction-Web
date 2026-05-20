import "server-only"

export function safeJsonError(message: string, status = 500) {
  return Response.json({ error: message }, { status })
}

export function getRequestSecret(request: Request, headerName: string) {
  const headerValue = request.headers.get(headerName)

  if (headerValue) {
    return headerValue
  }

  const authorization = request.headers.get("authorization")

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length)
  }

  return null
}

export function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) {
    return false
  }

  let mismatch = 0

  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }

  return mismatch === 0
}

export function verifySharedSecret(provided: string | null, expected: string | undefined) {
  if (!expected || !provided) {
    return false
  }

  return constantTimeEqual(provided, expected)
}

// Shared-secret plugin auth has no replay protection. It is opt-in for
// staging/bootstrap only; production must leave this unset so RealCore is
// forced onto HMAC signing. Vote-webhook secrets are unaffected by this gate.
export function isSharedSecretAuthAllowed() {
  return process.env.REALCORE_ALLOW_SHARED_SECRET === "true"
}

export function requireConfiguredSecret(name: string) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is not configured.`)
  }

  return value
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function createVerificationCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)

  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("")
}
