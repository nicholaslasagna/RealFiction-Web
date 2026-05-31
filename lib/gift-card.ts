// Pure gift-card code helpers (no "server-only" so they're unit testable).
//
// Normalization MUST match the SQL side in
// supabase/migrations/202605300030_gift_card_lifecycle.sql: strip every
// non-alphanumeric character and uppercase, then sha256 → lowercase hex. This
// lets a user paste "rf-a1b2-c3d4-e5f6", "RF A1B2 C3D4 E5F6", etc. and still
// match the stored code_hash. The plaintext code never needs to leave the
// browser/route — only its hash is sent to the redemption RPC.

export function normalizeGiftCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
}

export async function giftCodeHash(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeGiftCode(code))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
