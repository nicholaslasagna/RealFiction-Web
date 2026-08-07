// Claim-credential cryptography.
//
// The previous design failed on entropy and on using an unkeyed digest. These
// tests assert both properties directly, plus the ones that only matter when
// something goes wrong: a tampered ciphertext, a wrong key, a missing pepper,
// and — the one that is easiest to get wrong and worst to discover late —
// whether a secret can escape through an error message.
import assert from "node:assert/strict"
import { register } from "node:module"
import { mock, test } from "node:test"

register("./test-alias-hook.mjs", import.meta.url)

mock.module("server-only", { namedExports: {}, defaultExport: {} })

const {
  CLAIM_SECRET_BYTES,
  computeClaimVerifier,
  createClaimCredential,
  encryptionKeyVersion,
  generateClaimSecret,
  GiftCardCryptoUnavailableError,
  isCanonicalClaimSecret,
  isGiftCardCryptoConfigured,
  openClaimSecret,
  sealClaimSecret,
  verifiersMatch
} = await import("./gift-card/crypto.ts")

/** Test-only key material. Deterministic, obviously fake, never a real key. */
const KEY_A = "0".repeat(64)
const KEY_B = "1".repeat(64)
const PEPPER_A = "a".repeat(64)
const PEPPER_B = "b".repeat(64)

const ENV = {
  GIFT_CARD_CLAIM_PEPPER: PEPPER_A,
  GIFT_CARD_ENCRYPTION_KEY: KEY_A,
  GIFT_CARD_ENCRYPTION_KEY_VERSION: "1"
}

// -- Entropy and encoding -----------------------------------------------------

test("a claim secret carries 256 bits of randomness", () => {
  assert.equal(CLAIM_SECRET_BYTES, 32)
  const secret = generateClaimSecret()
  // 32 bytes of base64url, unpadded.
  assert.equal(secret.length, 43)
  assert.ok(isCanonicalClaimSecret(secret))
})

test("secrets are URL-safe and need no encoding in a link", () => {
  for (let i = 0; i < 50; i++) {
    const secret = generateClaimSecret()
    assert.equal(encodeURIComponent(secret), secret, `${secret} would be re-encoded in a URL`)
  }
})

test("secrets do not repeat", () => {
  const seen = new Set<string>()
  for (let i = 0; i < 500; i++) {
    seen.add(generateClaimSecret())
  }
  assert.equal(seen.size, 500)
})

test("non-canonical forms are refused, not normalized", () => {
  const secret = generateClaimSecret()
  for (const bad of [
    "",
    secret.slice(0, 42),
    `${secret}A`,
    ` ${secret}`,
    `${secret} `,
    `${secret}=`,
    // Deterministically non-canonical: replacing the last character with "+"
    // always leaves the alphabet, whereas mutating "-"/"_" characters that a
    // given random secret may not contain made this test flaky.
    `${secret.slice(0, -1)}+`,
    `${secret.slice(0, -1)}/`,
    "!".repeat(43)
  ]) {
    assert.equal(isCanonicalClaimSecret(bad), false, `accepted "${bad.slice(0, 20)}"`)
  }
})

// -- The verifier -------------------------------------------------------------

test("the verifier is deterministic for one secret and pepper", async () => {
  const secret = generateClaimSecret()
  const first = await computeClaimVerifier(secret, ENV)
  const second = await computeClaimVerifier(secret, ENV)
  assert.equal(first, second)
  assert.match(first, /^[0-9a-f]{64}$/)
})

test("a DIFFERENT pepper produces a different verifier for the same secret", async () => {
  // This is the property the old unkeyed sha256 lacked: without the pepper, a
  // leaked verifier column cannot be matched against guessed secrets.
  const secret = generateClaimSecret()
  const withA = await computeClaimVerifier(secret, ENV)
  const withB = await computeClaimVerifier(secret, { ...ENV, GIFT_CARD_CLAIM_PEPPER: PEPPER_B })
  assert.notEqual(withA, withB)
})

test("different secrets produce different verifiers", async () => {
  const a = await computeClaimVerifier(generateClaimSecret(), ENV)
  const b = await computeClaimVerifier(generateClaimSecret(), ENV)
  assert.notEqual(a, b)
})

test("verifier comparison is length-safe and value-correct", () => {
  assert.equal(verifiersMatch("abc", "abc"), true)
  assert.equal(verifiersMatch("abc", "abd"), false)
  assert.equal(verifiersMatch("abc", "ab"), false)
  assert.equal(verifiersMatch("", ""), true)
  assert.equal(verifiersMatch(null as never, "abc"), false)
})

// -- Sealing ------------------------------------------------------------------

test("a sealed secret round-trips", async () => {
  const secret = generateClaimSecret()
  const sealed = await sealClaimSecret(secret, ENV)
  assert.equal(await openClaimSecret(sealed.ciphertext, ENV), secret)
})

test("sealing the same secret twice produces different ciphertext", async () => {
  // A fresh IV per seal. Identical ciphertext would leak that two cards carry
  // the same secret.
  const secret = generateClaimSecret()
  const first = await sealClaimSecret(secret, ENV)
  const second = await sealClaimSecret(secret, ENV)
  assert.notEqual(first.ciphertext, second.ciphertext)
  assert.equal(await openClaimSecret(second.ciphertext, ENV), secret)
})

test("TAMPERED ciphertext is rejected, not decrypted to something else", async () => {
  const sealed = await sealClaimSecret(generateClaimSecret(), ENV)
  const [version, iv, body] = sealed.ciphertext.split(".")

  // Mutate a MIDDLE character, not the last one. The final base64url character
  // of a group carries fewer significant bits, so flipping it can decode to
  // identical bytes — a "tampered" value that is not tampered at all, which
  // made this test intermittently pass a valid ciphertext.
  const flip = (value: string) => {
    const at = Math.floor(value.length / 2)
    return value.slice(0, at) + (value[at] === "A" ? "B" : "A") + value.slice(at + 1)
  }

  for (const broken of [
    `${version}.${iv}.${flip(body)}`,
    `${version}.${flip(iv)}.${body}`,
    `${version}.${iv}`,
    `${iv}.${body}`,
    "not-a-ciphertext",
    ""
  ]) {
    assert.equal(await openClaimSecret(broken, ENV), null, `opened tampered "${broken.slice(0, 24)}"`)
  }
})

test("the WRONG key cannot open a sealed secret", async () => {
  const sealed = await sealClaimSecret(generateClaimSecret(), ENV)
  assert.equal(await openClaimSecret(sealed.ciphertext, { ...ENV, GIFT_CARD_ENCRYPTION_KEY: KEY_B }), null)
})

test("a key-version mismatch refuses rather than guessing", async () => {
  const sealed = await sealClaimSecret(generateClaimSecret(), ENV)
  assert.equal(sealed.keyVersion, 1)
  assert.match(sealed.ciphertext, /^v1\./)
  assert.equal(await openClaimSecret(sealed.ciphertext, { ...ENV, GIFT_CARD_ENCRYPTION_KEY_VERSION: "2" }), null)
})

test("the masked suffix is short, and is not the secret", async () => {
  const secret = generateClaimSecret()
  const sealed = await sealClaimSecret(secret, ENV)
  assert.equal(sealed.maskedSuffix.length, 4)
  assert.equal(sealed.maskedSuffix, secret.slice(-4))
  assert.notEqual(sealed.maskedSuffix, secret)
})

// -- Fail closed --------------------------------------------------------------

test("missing or unusable configuration fails CLOSED", async () => {
  assert.equal(isGiftCardCryptoConfigured({}), false)
  assert.equal(isGiftCardCryptoConfigured({ GIFT_CARD_CLAIM_PEPPER: PEPPER_A }), false)
  assert.equal(isGiftCardCryptoConfigured({ ...ENV, GIFT_CARD_ENCRYPTION_KEY: "too-short" }), false)
  assert.equal(isGiftCardCryptoConfigured({ ...ENV, GIFT_CARD_CLAIM_PEPPER: "  " }), false)
  assert.equal(isGiftCardCryptoConfigured({ ...ENV, GIFT_CARD_ENCRYPTION_KEY_VERSION: "0" }), false)
  assert.equal(isGiftCardCryptoConfigured(ENV), true)
})

test("a short key is REFUSED, never stretched into a plausible-looking one", async () => {
  await assert.rejects(
    () => sealClaimSecret(generateClaimSecret(), { ...ENV, GIFT_CARD_ENCRYPTION_KEY: "abcd" }),
    (error: Error) => error instanceof GiftCardCryptoUnavailableError
  )
})

test("hex and base64url key material are both accepted at 32 bytes", async () => {
  const secret = generateClaimSecret()
  const base64Key = Buffer.from("2".repeat(64), "hex").toString("base64url")
  const sealed = await sealClaimSecret(secret, { ...ENV, GIFT_CARD_ENCRYPTION_KEY: base64Key })
  assert.equal(await openClaimSecret(sealed.ciphertext, { ...ENV, GIFT_CARD_ENCRYPTION_KEY: base64Key }), secret)
})

test("the key version must be a positive integer", () => {
  assert.equal(encryptionKeyVersion(ENV), 1)
  for (const bad of ["0", "-1", "x", "1.5"]) {
    assert.throws(() => encryptionKeyVersion({ ...ENV, GIFT_CARD_ENCRYPTION_KEY_VERSION: bad }))
  }
})

// -- Leakage ------------------------------------------------------------------

test("NO error message or stack ever contains the secret, key, or pepper", async () => {
  const secret = generateClaimSecret()
  const attempts: unknown[] = []

  for (const broken of [
    { ...ENV, GIFT_CARD_ENCRYPTION_KEY: "" },
    { ...ENV, GIFT_CARD_CLAIM_PEPPER: "" },
    { ...ENV, GIFT_CARD_ENCRYPTION_KEY: "short" },
    { ...ENV, GIFT_CARD_ENCRYPTION_KEY_VERSION: "nope" }
  ]) {
    try {
      await sealClaimSecret(secret, broken)
    } catch (error) {
      attempts.push(error)
    }
    try {
      await computeClaimVerifier(secret, broken)
    } catch (error) {
      attempts.push(error)
    }
  }

  assert.ok(attempts.length > 0, "expected the broken configurations to throw")
  for (const error of attempts) {
    const text = `${(error as Error).message}\n${(error as Error).stack ?? ""}\n${JSON.stringify(error)}`
    assert.ok(!text.includes(secret), "an error carried the claim secret")
    assert.ok(!text.includes(KEY_A), "an error carried the encryption key")
    assert.ok(!text.includes(PEPPER_A), "an error carried the pepper")
  }
})

test("a non-canonical secret is refused before any key is touched", async () => {
  // Refusing early means a malformed value can never reach the HMAC or the
  // cipher, so it cannot appear in a lower-level library's error either.
  await assert.rejects(() => computeClaimVerifier("not-canonical", ENV), GiftCardCryptoUnavailableError)
  await assert.rejects(() => sealClaimSecret("not-canonical", ENV), GiftCardCryptoUnavailableError)
})

// -- The credential a card is issued with -------------------------------------

test("createClaimCredential returns a consistent, openable credential", async () => {
  const credential = await createClaimCredential(ENV)

  assert.ok(isCanonicalClaimSecret(credential.secret))
  assert.equal(credential.verifier, await computeClaimVerifier(credential.secret, ENV))
  assert.equal(await openClaimSecret(credential.sealed.ciphertext, ENV), credential.secret)
  assert.equal(credential.sealed.keyVersion, 1)

  // The stored values must not contain the secret in any recoverable form.
  assert.ok(!credential.verifier.includes(credential.secret))
  assert.ok(!credential.sealed.ciphertext.includes(credential.secret))
})

test("two issued credentials never collide", async () => {
  const first = await createClaimCredential(ENV)
  const second = await createClaimCredential(ENV)
  assert.notEqual(first.secret, second.secret)
  assert.notEqual(first.verifier, second.verifier)
})
