import assert from "node:assert/strict"
import { test } from "node:test"

import { computeCreditApplication } from "./store-credit.ts"

test("full coverage — credit equals subtotal, nothing due", () => {
  assert.deepEqual(computeCreditApplication(500, 500, true), { creditCents: 500, dueCents: 0 })
})

test("over-coverage — credit is capped at the subtotal", () => {
  assert.deepEqual(computeCreditApplication(500, 800, true), { creditCents: 500, dueCents: 0 })
})

test("partial coverage — only the remainder is due", () => {
  assert.deepEqual(computeCreditApplication(800, 500, true), { creditCents: 500, dueCents: 300 })
})

test("cannot apply more credit than available", () => {
  const { creditCents } = computeCreditApplication(1000, 250, true)
  assert.equal(creditCents, 250)
})

test("apply=false (or signed-out → availableCents 0) applies no credit", () => {
  assert.deepEqual(computeCreditApplication(500, 500, false), { creditCents: 0, dueCents: 500 })
  assert.deepEqual(computeCreditApplication(500, 0, true), { creditCents: 0, dueCents: 500 })
})

test("never produces a negative balance or negative due", () => {
  assert.deepEqual(computeCreditApplication(500, -100, true), { creditCents: 0, dueCents: 500 })
  const r = computeCreditApplication(-50, 999, true)
  assert.equal(r.creditCents, 0)
  assert.equal(r.dueCents, 0)
})

test("integer cents only", () => {
  const r = computeCreditApplication(799, 500, true)
  assert.equal(Number.isInteger(r.creditCents), true)
  assert.equal(Number.isInteger(r.dueCents), true)
  assert.equal(r.creditCents + r.dueCents, 799)
})
