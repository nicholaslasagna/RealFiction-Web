// Gift-card claim credentials: generation, keyed verification, and sealing.
//
// THE THREAT THIS EXISTS FOR
// ==========================
// The previous design stored a 48-bit code in plaintext next to an unkeyed
// SHA-256 of itself. Reading the database was equivalent to reading every code.
//
// Here the secret is 256 bits and is NEVER stored. Two derived values are:
//
//   verifier   HMAC-SHA256(secret, pepper) — what claim lookup matches on.
//              Keyed, so a database leak alone yields nothing: an attacker
//              without the pepper cannot test a guess offline.
//
//   sealed     AES-256-GCM(secret, encryption key) — what lets the scheduled
//              email worker render a claim link minutes after checkout
//              returned. Authenticated, so a tampered ciphertext is rejected
//              rather than decrypting to attacker-chosen bytes.
//
// The pepper and the encryption key are DIFFERENT keys, and both are different
// from the RealCore HMAC secret, the Stripe keys, the Supabase keys, and the
// Resend key. Sharing any of them would mean one leak compromises two systems.
//
// Nothing here logs. Not the secret, not the ciphertext, not the key, not even
// a full verifier — a verifier is a bearer lookup value, and an attacker who
// obtains one can watch for the matching card. Errors carry a reason code and
// never the material that caused them.
//
// Web Crypto only: this runs in the Cloudflare Worker as well as in Node.

import "server-only"

export type GiftCardCryptoEnv = {
  GIFT_CARD_CLAIM_PEPPER?: string
  GIFT_CARD_ENCRYPTION_KEY?: string
  GIFT_CARD_ENCRYPTION_KEY_VERSION?: string
}

/** 256 bits. Not negotiable downward — it is the whole security argument. */
export const CLAIM_SECRET_BYTES = 32

/** base64url of 32 bytes, no padding. */
const CANONICAL_SECRET = /^[A-Za-z0-9_-]{43}$/

/**
 * Thrown when configuration is absent or unusable.
 *
 * Carries a code, never a value. A caller that catches this must fail the
 * request closed — a gift card whose credential cannot be sealed must not be
 * issued, because it could never be delivered.
 */
export class GiftCardCryptoUnavailableError extends Error {
  readonly code: string

  constructor(code: string) {
    super(`Gift-card cryptography unavailable: ${code}`)
    this.name = "GiftCardCryptoUnavailableError"
    this.code = code
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((value.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * Decodes a key from base64url or hex, and insists on exactly 32 bytes.
 *
 * A short key is refused rather than stretched: silently padding a weak
 * configured value into a 256-bit key would produce something that looks
 * correctly sized and is not.
 */
function decodeKeyMaterial(raw: string, code: string): Uint8Array<ArrayBuffer> {
  const trimmed = raw.trim()
  let bytes: Uint8Array<ArrayBuffer>

  try {
    if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      const pairs = trimmed.match(/../g)!
      bytes = new Uint8Array(new ArrayBuffer(pairs.length))
      pairs.forEach((pair, index) => {
        bytes[index] = parseInt(pair, 16)
      })
    } else {
      bytes = base64UrlDecode(trimmed)
    }
  } catch {
    throw new GiftCardCryptoUnavailableError(code)
  }

  if (bytes.length !== 32) {
    throw new GiftCardCryptoUnavailableError(code)
  }
  return bytes
}

function requirePepper(env: GiftCardCryptoEnv): Uint8Array<ArrayBuffer> {
  const raw = env.GIFT_CARD_CLAIM_PEPPER?.trim()
  if (!raw) {
    throw new GiftCardCryptoUnavailableError("pepper_missing")
  }
  return decodeKeyMaterial(raw, "pepper_invalid")
}

function requireEncryptionKey(env: GiftCardCryptoEnv): Uint8Array<ArrayBuffer> {
  const raw = env.GIFT_CARD_ENCRYPTION_KEY?.trim()
  if (!raw) {
    throw new GiftCardCryptoUnavailableError("encryption_key_missing")
  }
  return decodeKeyMaterial(raw, "encryption_key_invalid")
}

export function encryptionKeyVersion(env: GiftCardCryptoEnv): number {
  const raw = (env.GIFT_CARD_ENCRYPTION_KEY_VERSION ?? "1").trim()
  // Matched before parsing: `parseInt` would turn "1.5" into 1 and "2abc" into
  // 2, so a typo'd version would silently seal under the wrong key rather than
  // failing at configuration time.
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new GiftCardCryptoUnavailableError("key_version_invalid")
  }
  return Number.parseInt(raw, 10)
}

/**
 * True when every gift-card key is present and usable.
 *
 * The feature gate calls this. It deliberately reports a boolean and not a
 * reason: the reason belongs in a server log line the operator reads, not in an
 * API response that tells an attacker which key is missing.
 */
export function isGiftCardCryptoConfigured(env: GiftCardCryptoEnv): boolean {
  try {
    requirePepper(env)
    requireEncryptionKey(env)
    encryptionKeyVersion(env)
    return true
  } catch {
    return false
  }
}

/** A fresh 256-bit claim secret, in the canonical form the recipient receives. */
export function generateClaimSecret(): string {
  const bytes = new Uint8Array(new ArrayBuffer(CLAIM_SECRET_BYTES))
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

/**
 * Rejects anything that is not exactly our canonical form.
 *
 * Strict on purpose. Accepting a "close enough" secret — different padding,
 * different alphabet, surrounding whitespace — would mean two distinct strings
 * could produce two different verifiers for one card, and a recipient could
 * find their working link stops working.
 */
export function isCanonicalClaimSecret(secret: string): boolean {
  return typeof secret === "string" && CANONICAL_SECRET.test(secret)
}

/**
 * HMAC-SHA256(secret, pepper), hex.
 *
 * Deterministic for a given (secret, pepper), so claim lookup is a single
 * indexed equality — and because the comparison happens inside Postgres on an
 * indexed column, there is no string comparison in application code to leak
 * timing. `verifyClaimSecret` below covers the case where a caller does need to
 * compare two verifiers in JavaScript.
 */
export async function computeClaimVerifier(secret: string, env: GiftCardCryptoEnv): Promise<string> {
  if (!isCanonicalClaimSecret(secret)) {
    throw new GiftCardCryptoUnavailableError("secret_not_canonical")
  }

  const key = await crypto.subtle.importKey(
    "raw",
    requirePepper(env),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(secret))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Constant-time verifier comparison, for callers that compare in JS. */
export function verifiersMatch(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false
  }
  let difference = 0
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

export type SealedSecret = {
  /** `v<version>.<iv>.<ciphertext+tag>`, all base64url. */
  ciphertext: string
  keyVersion: number
  /** Last 4 characters of the secret. Support-safe; useless for claiming. */
  maskedSuffix: string
}

/**
 * Seals the secret so the scheduled email worker can render it later.
 *
 * AES-256-GCM with a fresh 96-bit IV per seal. Authenticated: a tampered
 * ciphertext fails to decrypt rather than yielding attacker-chosen plaintext,
 * which matters because the decrypted value goes straight into a claim link.
 */
export async function sealClaimSecret(
  secret: string,
  env: GiftCardCryptoEnv
): Promise<SealedSecret> {
  if (!isCanonicalClaimSecret(secret)) {
    throw new GiftCardCryptoUnavailableError("secret_not_canonical")
  }

  const version = encryptionKeyVersion(env)
  const key = await crypto.subtle.importKey("raw", requireEncryptionKey(env), { name: "AES-GCM" }, false, [
    "encrypt"
  ])
  const iv = new Uint8Array(new ArrayBuffer(12))
  crypto.getRandomValues(iv)

  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secret)
  )

  return {
    ciphertext: `v${version}.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(sealed))}`,
    keyVersion: version,
    maskedSuffix: secret.slice(-4)
  }
}

/**
 * Opens a sealed secret. ONLY for rendering a transactional delivery.
 *
 * Returns null on any failure — wrong key, tampered ciphertext, malformed
 * envelope, version mismatch. The caller cannot distinguish them, and must not:
 * a delivery that cannot be rendered is simply retried or escalated, and the
 * difference between "wrong key" and "tampered" is an operator question
 * answered from logs of the failure COUNT, not from a response.
 */
export async function openClaimSecret(
  ciphertext: string,
  env: GiftCardCryptoEnv
): Promise<string | null> {
  try {
    const parts = String(ciphertext).split(".")
    if (parts.length !== 3 || !parts[0].startsWith("v")) {
      return null
    }

    const version = Number.parseInt(parts[0].slice(1), 10)
    if (!Number.isInteger(version) || version !== encryptionKeyVersion(env)) {
      // A future rotation resolves the historic key here rather than failing;
      // today there is exactly one version, so a mismatch is a real problem.
      return null
    }

    const key = await crypto.subtle.importKey("raw", requireEncryptionKey(env), { name: "AES-GCM" }, false, [
      "decrypt"
    ])
    const opened = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlDecode(parts[1]) },
      key,
      base64UrlDecode(parts[2])
    )

    const secret = new TextDecoder().decode(opened)
    // A correctly-decrypting value that is not canonical means something is
    // wrong upstream; refuse rather than putting it in a link.
    return isCanonicalClaimSecret(secret) ? secret : null
  } catch {
    return null
  }
}

/**
 * Everything needed to issue one credential.
 *
 * The returned `secret` is the only plaintext copy that will ever exist. The
 * caller hands it to the delivery path and drops it; it is never persisted, and
 * the database never sees it.
 */
export async function createClaimCredential(env: GiftCardCryptoEnv): Promise<{
  secret: string
  verifier: string
  sealed: SealedSecret
}> {
  const secret = generateClaimSecret()
  const [verifier, sealed] = await Promise.all([
    computeClaimVerifier(secret, env),
    sealClaimSecret(secret, env)
  ])
  return { secret, verifier, sealed }
}
