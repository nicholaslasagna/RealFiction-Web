// Control-character sanitization in gift-card email content.
//
// CodeQL alert #10 (js/overly-large-range) was raised against the character
// class this replaced. That class was also written with literal control BYTES
// in the source file, which is why grep treated the file as binary and why no
// reviewer could see what it covered. Every control character below is written
// as an ESCAPE SEQUENCE for exactly that reason — a test that reintroduced raw
// bytes would recreate the unreadable thing the fix removed.
//
// These pin the POLICY, not the implementation: the sender name and the gift
// message are the only attacker-controlled strings that reach an email, so this
// is where header and plain-text injection would happen if it were possible.
import assert from "node:assert/strict"
import { register } from "node:module"
import { test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

const { buildGiftCardDeliveryEmail, buildGiftCardPurchaseEmail, GIFT_MESSAGE_MAX, SENDER_NAME_MAX } =
  await import("./email/gift-card-templates.ts")

// Written as ESCAPES, never as literal bytes — see the note above.
const NUL = "\u0000"
const BACKSPACE = "\u0008"
const TAB = "\u0009"
const LF = "\u000a"
const VTAB = "\u000b"
const FORM_FEED = "\u000c"
const CR = "\u000d"
const SHIFT_OUT = "\u000e"
const UNIT_SEPARATOR = "\u001f"
const DEL = "\u007f"

const BASE = {
  amountCents: 2500,
  currency: "USD",
  claimUrl: "https://realfiction.live/gift-cards/claim#secret",
  supportEmail: "support@realfiction.live",
  siteUrl: "https://realfiction.live"
}

/** The rendered message text, which is where a sender's string ends up. */
const render = (message: string, senderName = "Alice") =>
  buildGiftCardDeliveryEmail({ ...BASE, senderName, message })

// ===========================================================================
// REMOVED: unsafe C0 controls and DEL
// ===========================================================================

test("NUL is removed", () => {
  const email = render(`a${NUL}b`)
  assert.ok(!email.text.includes(NUL))
  assert.match(email.text, /"ab"/)
})

test("BACKSPACE is removed", () => {
  // Otherwise a terminal or a naive log viewer renders text that is not there.
  const email = render(`a${BACKSPACE}b`)
  assert.ok(!email.text.includes(BACKSPACE))
  assert.match(email.text, /"ab"/)
})

test("VERTICAL TAB is removed", () => {
  const email = render(`a${VTAB}b`)
  assert.ok(!email.text.includes(VTAB))
})

test("FORM FEED is removed", () => {
  const email = render(`a${FORM_FEED}b`)
  assert.ok(!email.text.includes(FORM_FEED))
})

test("0x0E and 0x1F — the ends of the stripped C0 range — are removed", () => {
  const email = render(`a${SHIFT_OUT}b${UNIT_SEPARATOR}c`)
  assert.ok(!email.text.includes(SHIFT_OUT))
  assert.ok(!email.text.includes(UNIT_SEPARATOR))
  assert.match(email.text, /"abc"/)
})

test("DEL is removed", () => {
  const email = render(`a${DEL}b`)
  assert.ok(!email.text.includes(DEL))
  assert.match(email.text, /"ab"/)
})

test("EVERY C0 control and DEL is gone from the rendered email", () => {
  // The exhaustive version: nothing below 0x20 may survive except the newlines
  // the template itself writes between lines.
  const hostile =
    Array.from({ length: 0x20 }, (_, code) => `x${String.fromCharCode(code)}`).join("") + DEL
  const email = render(hostile, hostile)

  for (const [label, body] of [
    ["text", email.text],
    ["html", email.html],
    ["subject", email.subject]
  ] as const) {
    for (const char of body) {
      const code = char.codePointAt(0) ?? 0
      const isTemplateNewline = char === LF && label !== "subject"
      assert.ok(
        code >= 0x20 || isTemplateNewline,
        `code point 0x${code.toString(16)} survived into the ${label}`
      )
    }
  }
})

// ===========================================================================
// PRESERVED long enough to normalize: tab, newline, carriage return
// ===========================================================================

test("TAB becomes a space rather than vanishing", () => {
  // Deleting it outright would run the words together.
  const email = render(`Happy${TAB}birthday`)
  assert.match(email.text, /"Happy birthday"/)
})

test("NEWLINE becomes a space, keeping the words apart", () => {
  const email = render(`Happy${LF}birthday`)
  assert.match(email.text, /"Happy birthday"/)
  assert.ok(!email.text.includes("Happybirthday"), "the words must not be fused")
})

test("CARRIAGE RETURN becomes a space", () => {
  const email = render(`Happy${CR}birthday`)
  assert.match(email.text, /"Happy birthday"/)
})

test("a run of mixed whitespace collapses to ONE space", () => {
  const email = render(`Happy ${TAB}${CR}${LF}   birthday`)
  assert.match(email.text, /"Happy birthday"/)
})

test("leading and trailing whitespace is trimmed", () => {
  const email = render(`  ${TAB} Happy birthday ${LF} `)
  assert.match(email.text, /"Happy birthday"/)
})

// ===========================================================================
// PRESERVED intact: ordinary Unicode and emoji
// ===========================================================================

test("ordinary Unicode survives unchanged", () => {
  const email = render("Grüße, naïve café — привет, 日本語")
  assert.match(email.text, /Grüße, naïve café — привет, 日本語/)
})

test("EMOJI survive, including astral and ZWJ sequences", () => {
  const email = render("Happy birthday 🎉 👩‍👩‍👧‍👦 🇬🇧")
  assert.match(email.text, /🎉/)
  assert.match(email.text, /👩‍👩‍👧‍👦/, "a ZWJ family must not be split")
  assert.match(email.text, /🇬🇧/)
})

test("the length limit cuts by CODE POINT, never mid-emoji", () => {
  const email = render("🎉".repeat(GIFT_MESSAGE_MAX + 50))

  for (const char of email.text) {
    const code = char.codePointAt(0) ?? 0
    // A lone surrogate would land in D800-DFFF.
    assert.ok(code < 0xd800 || code > 0xdfff, "a surrogate pair was split")
  }
})

// ===========================================================================
// INJECTION REMAINS IMPOSSIBLE
// ===========================================================================

test("a SENDER NAME cannot inject a header into the subject", () => {
  const email = render("hi", `Alice${CR}${LF}Bcc: victim@example.com`)

  assert.ok(!email.subject.includes(CR), "CR in a subject is a header injection")
  assert.ok(!email.subject.includes(LF), "LF in a subject is a header injection")
  assert.ok(!/^\s*Bcc:/im.test(email.subject))
})

test("a MESSAGE cannot inject a header", () => {
  const email = render(`hi${CR}${LF}Bcc: victim@example.com${CR}${LF}Subject: gotcha`)

  assert.ok(!email.text.includes(CR), "no bare CR anywhere")
  // The injected words survive as TEXT on the message line — harmless — but
  // never as a line of their own, which is what a header needs.
  for (const line of email.text.split(LF)) {
    assert.ok(!/^\s*(Bcc|Cc|To|Subject|Reply-To):/i.test(line), `header-shaped line: ${line}`)
  }
})

test("a sender cannot break out of the quoted message block", () => {
  // The plain-text part wraps the message in quotes on one line. A line break
  // inside it would let a sender write what looks like our own copy.
  const email = render(`nice"${LF}${LF}Claim your prize here: https://evil.example`)

  const quoted = email.text.split(LF).filter((line) => line.startsWith('"'))
  assert.equal(quoted.length, 1, "the message must occupy exactly one line")
  assert.ok(!/^Claim your prize/m.test(email.text))
})

test("the PURCHASER receipt sanitizes the sender name the same way", () => {
  const email = buildGiftCardPurchaseEmail({
    amountCents: 2500,
    currency: "USD",
    recipientEmail: "friend@example.com",
    senderName: `Alice${CR}${LF}Bcc: victim@example.com${NUL}`,
    sentToSelf: false,
    publicRef: "RFG-ABCDEF0123",
    supportEmail: "support@realfiction.live",
    siteUrl: "https://realfiction.live"
  })

  assert.ok(!email.text.includes(NUL))
  assert.ok(!email.subject.includes(LF))
  for (const line of email.text.split(LF)) {
    assert.ok(!/^\s*Bcc:/i.test(line))
  }
})

test("the length limits are still enforced after sanitization", () => {
  const email = render("x".repeat(GIFT_MESSAGE_MAX + 500), "y".repeat(SENDER_NAME_MAX + 500))

  const messageLine = email.text.split(LF).find((line) => line.startsWith('"')) ?? ""
  // The quotes are the template's, so the budget is the limit plus those two.
  assert.ok(messageLine.length <= GIFT_MESSAGE_MAX + 2, "message exceeded its limit")
  assert.ok(!email.subject.includes("y".repeat(SENDER_NAME_MAX + 1)), "sender name exceeded its limit")
})

test("control characters cannot be used to pad past the length limit", () => {
  // Stripping happens BEFORE the limit, so a sender cannot spend the budget on
  // invisible characters and smuggle more visible text through.
  const email = render(NUL.repeat(1000) + "z".repeat(20))
  assert.match(email.text, /"z{20}"/)
})
