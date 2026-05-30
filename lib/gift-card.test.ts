import assert from "node:assert/strict"
import { test } from "node:test"

import { giftCodeHash, normalizeGiftCode } from "./gift-card.ts"

test("normalizeGiftCode strips formatting and uppercases", () => {
  assert.equal(normalizeGiftCode("rf-a1b2-c3d4-e5f6"), "RFA1B2C3D4E5F6")
  assert.equal(normalizeGiftCode("RF A1B2 C3D4 E5F6"), "RFA1B2C3D4E5F6")
  assert.equal(normalizeGiftCode("  RF-A1B2-C3D4-E5F6  "), "RFA1B2C3D4E5F6")
})

test("differently-formatted codes hash identically", async () => {
  const a = await giftCodeHash("RF-A1B2-C3D4-E5F6")
  const b = await giftCodeHash("rf a1b2 c3d4 e5f6")
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{64}$/)
})

test("different codes hash differently", async () => {
  const a = await giftCodeHash("RF-A1B2-C3D4-E5F6")
  const b = await giftCodeHash("RF-A1B2-C3D4-E5F7")
  assert.notEqual(a, b)
})

test("hash matches the SQL digest contract (sha256 of normalized code)", async () => {
  // Known vector: sha256("RFAB12CD34EF56") — keep in lockstep with the SQL
  // encode(digest(upper(regexp_replace(code,'[^A-Za-z0-9]','','g')),'sha256'),'hex').
  const { createHash } = await import("node:crypto")
  const expected = createHash("sha256").update("RFAB12CD34EF56").digest("hex")
  assert.equal(await giftCodeHash("rf-ab12-cd34-ef56"), expected)
})
