// Zero-dependency unit tests for the store delivery-target resolver.
//
// Run with:  npm test   (node --test lib/store-delivery.test.ts)
//
// Covers the checkout delivery precedence and the hardening rules:
//   - gift recipient wins in gift mode
//   - a normal purchase delivers to the linked account (no client username)
//   - a normal purchase with no linked account is "missing" (route rejects)
//   - a gift with no recipient is "missing" (route rejects — never the buyer)
//   - a client cannot spoof a normal-purchase username

import assert from "node:assert/strict"
import { test } from "node:test"

import { resolveDeliveryTarget } from "./store-delivery.ts"

test("gift mode delivers to the gift recipient", () => {
  const result = resolveDeliveryTarget({
    isGift: true,
    giftRecipient: "TheirName",
    linkedUsername: "LittleNicholas"
  })
  assert.deepEqual(result, { username: "TheirName", source: "gift_recipient", isGift: true })
})

test("normal purchase with a linked account delivers to the linked account", () => {
  const result = resolveDeliveryTarget({
    isGift: false,
    giftRecipient: null,
    submittedUsername: undefined,
    linkedUsername: "LittleNicholas"
  })
  assert.deepEqual(result, { username: "LittleNicholas", source: "linked_account", isGift: false })
})

test("explicit submitted username is honored above the linked account", () => {
  // The helper supports the full precedence (gift > submitted > linked); the
  // checkout route deliberately never forwards a submitted username for normal
  // purchases, but the resolver contract is verified here.
  const result = resolveDeliveryTarget({
    submittedUsername: "TypedName",
    linkedUsername: "LittleNicholas"
  })
  assert.deepEqual(result, { username: "TypedName", source: "submitted_username", isGift: false })
})

test("normal purchase with no linked account resolves to missing", () => {
  const result = resolveDeliveryTarget({ isGift: false, linkedUsername: null })
  assert.equal(result.username, null)
  assert.equal(result.source, "missing")
})

test("gift mode with no recipient resolves to missing (never the buyer)", () => {
  const result = resolveDeliveryTarget({
    isGift: true,
    giftRecipient: "   ",
    linkedUsername: "LittleNicholas"
  })
  assert.equal(result.username, null)
  assert.equal(result.source, "missing")
  assert.equal(result.isGift, true)
})

test("a client cannot spoof the normal-purchase target via giftRecipient", () => {
  // Not gift mode: a stray giftRecipient is ignored and delivery stays with the
  // linked account.
  const result = resolveDeliveryTarget({
    isGift: false,
    giftRecipient: "SomeoneElse",
    linkedUsername: "LittleNicholas"
  })
  assert.deepEqual(result, { username: "LittleNicholas", source: "linked_account", isGift: false })
})
