// The words a customer sees.
//
// These are the strings a purchaser reads about their refund and a recipient
// reads about their frozen credit. The tests are less about wording than about
// what the wording is FORBIDDEN to contain.
import assert from "node:assert/strict"
import { register } from "node:module"
import { test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const { purchaserBadge, recipientBadge, recipientCreditState } = await import("./gift-card/customer-state.ts")

const PURCHASER = ["refund_processing", "refunded", "refund_review", "disputed"] as const
const RECIPIENT = ["frozen", "restored"] as const

const flatten = (badge: { label: string; detail: string }) => `${badge.label} ${badge.detail}`

test("every purchaser state has a label and an explaining sentence", () => {
  for (const state of PURCHASER) {
    const badge = purchaserBadge(state)
    assert.ok(badge, `${state} has no badge`)
    assert.ok(badge.label.length > 0)
    // Color alone is not information; the sentence is what survives grayscale.
    assert.ok(badge.detail.length > 30, `${state} has no explaining sentence`)
  }
})

test("the four purchaser labels are distinct", () => {
  const labels = PURCHASER.map((s) => purchaserBadge(s)!.label)
  assert.equal(new Set(labels).size, 4)
})

test("NO purchaser state describes what the recipient did", () => {
  // This is the whole reason `refund_review` is one state and not four.
  for (const state of PURCHASER) {
    const text = flatten(purchaserBadge(state)!)
    for (const leak of [/spent/i, /claimed/i, /unclaimed/i, /redeem/i, /recipient/i, /balance/i, /partial/i]) {
      assert.doesNotMatch(text, leak, `${state} leaked ${leak}`)
    }
  }
})

test("NO recipient state names a dispute, a chargeback, or the purchaser", () => {
  for (const state of RECIPIENT) {
    const text = flatten(recipientBadge(state)!)
    for (const leak of [/chargeback/i, /fraud/i, /purchaser/i, /sender/i, /stolen/i]) {
      assert.doesNotMatch(text, leak, `${state} leaked ${leak}`)
    }
  }
  // "Restored after dispute resolution" is the owner's chosen label and is the
  // one place the word appears — in the past tense, about a closed matter.
  assert.doesNotMatch(recipientBadge("frozen")!.label + recipientBadge("frozen")!.detail, /dispute/i)
})

test("no state string carries an internal identifier", () => {
  for (const badge of [...PURCHASER.map(purchaserBadge), ...RECIPIENT.map(recipientBadge)]) {
    const text = flatten(badge!)
    assert.doesNotMatch(text, /eligible_|provider_|review_required|gift_card_|_cents/)
  }
})

test("an unknown or missing state renders NOTHING, never a raw value", () => {
  for (const value of [null, undefined, "", "eligible_unclaimed", "provider_refund_pending", "rejected", "__proto__"]) {
    assert.equal(purchaserBadge(value), null, `purchaser rendered ${value}`)
    assert.equal(recipientBadge(value), null, `recipient rendered ${value}`)
  }
})

test("a live hold outranks a recent restoration", () => {
  // Telling someone their credit is back while some of it is still frozen is
  // worse than saying nothing.
  assert.equal(recipientCreditState({ holdCents: 2500, restoredRecently: true }), "frozen")
  assert.equal(recipientCreditState({ holdCents: 2500, restoredRecently: false }), "frozen")
  assert.equal(recipientCreditState({ holdCents: 0, restoredRecently: true }), "restored")
  assert.equal(recipientCreditState({ holdCents: 0, restoredRecently: false }), null)
})

test("American English", () => {
  for (const badge of [...PURCHASER.map(purchaserBadge), ...RECIPIENT.map(recipientBadge)]) {
    assert.doesNotMatch(flatten(badge!), /colour|authorise|cancelled|recognise|apologise|whilst/i)
  }
})
