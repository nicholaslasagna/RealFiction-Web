// Zero-dependency unit tests for the contact -> Discord payload builder.
//
// Run with:  npm test   (node --test lib/contact-notify.test.ts)
//
// Covers the parts that matter for safety/correctness:
//   - ticket id, topic, message, and fields are carried through
//   - a missing Minecraft username renders a dash, not "null"
//   - mentions are always disabled so submitted text can never ping the server
//   - an over-long message is truncated to Discord's limits

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildContactDiscordPayload } from "./contact-notify.ts"

const base = {
  name: "LittleNicholas",
  email: "nick@example.com",
  minecraftUsername: "LittleNicholas",
  topic: "Billing",
  message: "I was double charged on order ABC123."
}

test("payload carries the ticket, topic, message, and fields", () => {
  const payload = buildContactDiscordPayload(base, "tk_123")
  assert.equal(payload.embeds[0].title, "New support request: Billing")
  assert.equal(payload.embeds[0].description, "I was double charged on order ABC123.")
  const fields = Object.fromEntries(payload.embeds[0].fields.map((f) => [f.name, f.value]))
  assert.equal(fields.Name, "LittleNicholas")
  assert.equal(fields.Email, "nick@example.com")
  assert.equal(fields.Minecraft, "LittleNicholas")
  assert.match(payload.embeds[0].footer.text, /tk_123/)
})

test("a missing Minecraft username renders a dash", () => {
  const payload = buildContactDiscordPayload({ ...base, minecraftUsername: null }, "tk_1")
  const minecraft = payload.embeds[0].fields.find((f) => f.name === "Minecraft")
  assert.equal(minecraft?.value, "—")
})

test("mentions are always disabled so submitted content cannot ping the server", () => {
  const payload = buildContactDiscordPayload({ ...base, message: "hi @everyone @here <@123>" }, "tk_1")
  assert.deepEqual(payload.allowed_mentions, { parse: [] })
  // Content is preserved as plain text; pings are blocked by allowed_mentions,
  // not by mangling what the sender wrote.
  assert.match(payload.embeds[0].description, /@everyone/)
})

test("an over-long message is truncated to Discord's limits", () => {
  const payload = buildContactDiscordPayload({ ...base, message: "x".repeat(5000) }, "tk_1")
  assert.ok(payload.embeds[0].description.length <= 3900)
  assert.ok(payload.embeds[0].description.endsWith("…"))
})
