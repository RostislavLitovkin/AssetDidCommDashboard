import { describe, expect, it } from "vitest"
import { decodeBase64Key, validateX25519PublicKey } from "../../app/services/profile/x25519KeyValidation"

// 32 bytes, the shape `jose.exportJWK` puts in a public JWK's `x`.
const BASE64URL_KEY = "h5N_x5AzGHLbHfNBOBnaBpTXG2Yzs6xTv4YyLuxjXAA"
const BASE64_KEY = "h5N/x5AzGHLbHfNBOBnaBpTXG2Yzs6xTv4YyLuxjXAA="

describe("validateX25519PublicKey", () => {
  it("accepts the unpadded base64url form the app generates", () => {
    expect(validateX25519PublicKey(BASE64URL_KEY)).toBe("")
  })

  it("accepts padded standard base64 pasted from other tooling", () => {
    expect(validateX25519PublicKey(BASE64_KEY)).toBe("")
  })

  it("ignores surrounding whitespace", () => {
    expect(validateX25519PublicKey(`\n  ${BASE64URL_KEY}  `)).toBe("")
  })

  it("requires a key", () => {
    expect(validateX25519PublicKey("   ")).toBe("An X25519 public key is required.")
  })

  it("rejects values outside the base64 alphabets", () => {
    expect(validateX25519PublicKey("not base64!!")).toMatch(/not valid base64/)
    expect(validateX25519PublicKey("0x1234=5678")).toMatch(/not valid base64/)
  })

  it("rejects a 0x-prefixed hex key", () => {
    // Hex is the other notation these keys get written in. Its alphabet is a
    // subset of base64's, so only the decoded length rules it out.
    const hexKey = `0x${"1234567890abcdef".repeat(4)}`

    expect(validateX25519PublicKey(hexKey)).toMatch(/is 32 bytes/)
  })

  it("rejects a mix of the standard and URL-safe alphabets", () => {
    expect(validateX25519PublicKey("h5N/x5AzGHLbHfNBOBnaBpTXG2Yzs6xTv4YyLux-XAA")).toMatch(/not valid base64/)
  })

  it("rejects base64 that decodes to the wrong length", () => {
    expect(validateX25519PublicKey("aGVsbG8=")).toBe("An X25519 public key is 32 bytes; this one decodes to 5.")
  })
})

describe("decodeBase64Key", () => {
  it("decodes both alphabets to the same 32 bytes", () => {
    const fromBase64Url = decodeBase64Key(BASE64URL_KEY)
    const fromBase64 = decodeBase64Key(BASE64_KEY)

    expect(fromBase64Url).toHaveLength(32)
    expect(Array.from(fromBase64 ?? [])).toEqual(Array.from(fromBase64Url ?? []))
  })

  it("returns null for an empty value and for a truncated 4-character group", () => {
    expect(decodeBase64Key("")).toBeNull()
    // A single leftover character carries too few bits to be a byte.
    expect(decodeBase64Key("abcde")).toBeNull()
  })
})
