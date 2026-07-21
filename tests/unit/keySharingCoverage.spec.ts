import { describe, expect, it } from "vitest"
import {
  canonicalizeX25519,
  extractRecipientKids,
  findViewersWithoutKeyAccess
} from "../../app/services/messages/keySharingCoverage"

// 32-byte X25519 public key in its three wire encodings used across the app:
// on-chain hex, JWK base64url, and padded standard base64.
const keyBytes = new Uint8Array(32).map((_, i) => i + 1)
const keyHex = `0x${Array.from(keyBytes, b => b.toString(16).padStart(2, "0")).join("")}`
const keyBase64Url = Buffer.from(keyBytes).toString("base64url")
const keyBase64Padded = Buffer.from(keyBytes).toString("base64")

const otherKeyBase64Url = Buffer.from(new Uint8Array(32).map((_, i) => 255 - i)).toString("base64url")

function buildGeneralJwe(kids: string[]): string {
  return JSON.stringify({
    protected: Buffer.from(JSON.stringify({ enc: "A256GCM", typ: "didcomm/key-sharing-v1" })).toString("base64url"),
    iv: "aXY",
    ciphertext: "Y2lwaGVydGV4dA",
    tag: "dGFn",
    recipients: kids.map(kid => ({
      header: { alg: "ECDH-ES+A256KW", kid },
      encrypted_key: "ZW5jcnlwdGVkLWtleQ"
    }))
  })
}

describe("canonicalizeX25519", () => {
  it("converts 0x-prefixed hex keys to base64url", () => {
    expect(canonicalizeX25519(keyHex)).toBe(keyBase64Url)
  })

  it("keeps base64url keys canonical", () => {
    expect(canonicalizeX25519(keyBase64Url)).toBe(keyBase64Url)
  })

  it("normalizes padded standard base64 to base64url", () => {
    expect(canonicalizeX25519(keyBase64Padded)).toBe(keyBase64Url)
  })

  it("rejects values that are not 32-byte keys", () => {
    expect(canonicalizeX25519("123456789")).toBeNull() // numeric bucket keyId
    expect(canonicalizeX25519("Not found")).toBeNull()
    expect(canonicalizeX25519("")).toBeNull()
    expect(canonicalizeX25519(undefined)).toBeNull()
  })
})

describe("extractRecipientKids", () => {
  it("collects kids from general JWE recipient headers", () => {
    const jwe = buildGeneralJwe(["123456789", keyHex])
    expect(extractRecipientKids(jwe)).toEqual(["123456789", keyHex])
  })

  it("collects the kid of a flattened JWE header", () => {
    const flattened = JSON.stringify({
      protected: "e30",
      header: { alg: "ECDH-ES+A256KW", kid: keyBase64Url },
      iv: "aXY",
      ciphertext: "Y2lwaGVydGV4dA",
      tag: "dGFn"
    })
    expect(extractRecipientKids(flattened)).toEqual([keyBase64Url])
  })

  it("returns null for payloads that are not JWE JSON", () => {
    expect(extractRecipientKids("not json")).toBeNull()
    expect(extractRecipientKids(JSON.stringify({ hello: "world" }))).toBeNull()
  })
})

describe("findViewersWithoutKeyAccess", () => {
  it("reports no missing viewers when every viewer key appears as a kid", () => {
    // kid stored as on-chain hex, viewer key held as JWK base64url — must still match.
    const jwe = buildGeneralJwe(["123456789", keyHex])
    expect(findViewersWithoutKeyAccess(jwe, [keyBase64Url])).toEqual([])
  })

  it("reports viewers whose key is missing from the recipients", () => {
    const jwe = buildGeneralJwe(["123456789", keyHex])
    expect(findViewersWithoutKeyAccess(jwe, [keyBase64Url, otherKeyBase64Url])).toEqual([otherKeyBase64Url])
  })

  it("ignores viewer keys that cannot be decoded", () => {
    const jwe = buildGeneralJwe([keyHex])
    expect(findViewersWithoutKeyAccess(jwe, ["Not found"])).toEqual([])
  })

  it("returns null when the payload is not a parseable JWE", () => {
    expect(findViewersWithoutKeyAccess("garbage", [keyBase64Url])).toBeNull()
  })
})
