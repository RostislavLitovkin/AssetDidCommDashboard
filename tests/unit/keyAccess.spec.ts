import { describe, expect, it } from "vitest"
import {
  isX25519SecretJwk,
  latestKeySharingMessage,
  parsePlaintextKeySharingBody,
  resolveKeyAccessState,
  type KeySharingRef
} from "../../app/services/messages/keyAccess"

function keySharing(id: string, createdAt: string, messageId: string): KeySharingRef {
  return { id, createdAt, messageId }
}

const firstKey = keySharing("ks-1", "2026-07-01T10:00:00Z", "4")
const secondKey = keySharing("ks-2", "2026-07-20T10:00:00Z", "9")

describe("latestKeySharingMessage", () => {
  it("returns null when the bucket has no key-sharing message", () => {
    expect(latestKeySharingMessage([])).toBeNull()
  })

  it("returns the newest message regardless of the order it was fetched in", () => {
    expect(latestKeySharingMessage([secondKey, firstKey])).toBe(secondKey)
  })

  it("breaks a createdAt tie by numeric messageId, not string order", () => {
    const ninth = keySharing("ks-9", "2026-07-20T10:00:00Z", "9")
    const tenth = keySharing("ks-10", "2026-07-20T10:00:00Z", "10")

    expect(latestKeySharingMessage([tenth, ninth])).toBe(tenth)
  })

  it("ignores messages whose createdAt cannot be parsed rather than returning NaN ordering", () => {
    const broken = keySharing("ks-broken", "not-a-date", "1")

    expect(latestKeySharingMessage([broken, firstKey])).toBe(firstKey)
  })
})

describe("resolveKeyAccessState", () => {
  it("reports no-key-shared when the bucket has no key-sharing message at all", () => {
    const state = resolveKeyAccessState({
      hasSecret: true,
      keySharingMessages: [],
      decryptedIds: []
    })

    expect(state).toBe("no-key-shared")
  })

  it("reports no-key-shared ahead of no-secret — loading a secret cannot unlock a bucket with no key", () => {
    const state = resolveKeyAccessState({
      hasSecret: false,
      keySharingMessages: [],
      decryptedIds: []
    })

    expect(state).toBe("no-key-shared")
  })

  it("reports no-secret when a key was shared but no X25519 secret is loaded", () => {
    const state = resolveKeyAccessState({
      hasSecret: false,
      keySharingMessages: [firstKey, secondKey],
      decryptedIds: []
    })

    expect(state).toBe("no-secret")
  })

  it("reports ok when the latest key-sharing message was decrypted", () => {
    const state = resolveKeyAccessState({
      hasSecret: true,
      keySharingMessages: [firstKey, secondKey],
      decryptedIds: ["ks-1", "ks-2"]
    })

    expect(state).toBe("ok")
  })

  it("reports no-access when only a superseded key was decrypted", () => {
    const state = resolveKeyAccessState({
      hasSecret: true,
      keySharingMessages: [firstKey, secondKey],
      decryptedIds: ["ks-1"]
    })

    expect(state).toBe("no-access")
  })

  it("reports no-access when a secret is loaded but nothing could be decrypted", () => {
    const state = resolveKeyAccessState({
      hasSecret: true,
      keySharingMessages: [firstKey, secondKey],
      decryptedIds: []
    })

    expect(state).toBe("no-access")
  })
})

const SECRET_JWK = {
  kty: "OKP",
  crv: "X25519",
  x: "BI3FT5vBP6dB5LiYrQORRkU74d16vkBnlCRGgiDunVs",
  d: "UGmKM3wZsSiXt9XfTnNBCJRkCiBkk1AELBCMLJ6xWk4"
}

describe("isX25519SecretJwk", () => {
  it("accepts a full X25519 secret JWK", () => {
    expect(isX25519SecretJwk(SECRET_JWK)).toBe(true)
    expect(isX25519SecretJwk({ ...SECRET_JWK, use: "enc", kid: "1", y: "" })).toBe(true)
  })

  it("rejects public-only JWKs, other curves and non-objects", () => {
    expect(isX25519SecretJwk({ kty: "OKP", crv: "X25519", x: SECRET_JWK.x })).toBe(false)
    expect(isX25519SecretJwk({ ...SECRET_JWK, crv: "Ed25519" })).toBe(false)
    expect(isX25519SecretJwk({ ...SECRET_JWK, d: "" })).toBe(false)
    expect(isX25519SecretJwk(null)).toBe(false)
    expect(isX25519SecretJwk("jwk")).toBe(false)
    expect(isX25519SecretJwk([SECRET_JWK])).toBe(false)
  })
})

describe("parsePlaintextKeySharingBody", () => {
  const body = {
    id: "0b7d2f6e-9f71-4b1e-9c0a-2f4d3a1b2c3d",
    from: "seller-wallet-address",
    to: ["buyer-wallet-address", "seller-wallet-address"],
    keys: [SECRET_JWK]
  }

  it("accepts a plaintext key-sharing document", () => {
    expect(parsePlaintextKeySharingBody(body)).toEqual({
      id: body.id,
      from: body.from,
      to: body.to,
      keys: [SECRET_JWK]
    })
  })

  it("accepts the raw JSON string form (as hydrated from ipfsContent)", () => {
    expect(parsePlaintextKeySharingBody(JSON.stringify(body))).toEqual({
      id: body.id,
      from: body.from,
      to: body.to,
      keys: [SECRET_JWK]
    })
  })

  it("keeps only the valid secret JWKs when keys mixes in other entries", () => {
    const mixed = { ...body, keys: [{ kty: "OKP", crv: "X25519", x: SECRET_JWK.x }, SECRET_JWK, "nope"] }
    expect(parsePlaintextKeySharingBody(mixed)?.keys).toEqual([SECRET_JWK])
  })

  it("rejects documents without a single usable secret key", () => {
    expect(parsePlaintextKeySharingBody({ ...body, keys: [] })).toBeUndefined()
    expect(parsePlaintextKeySharingBody({ ...body, keys: [{ kty: "OKP", crv: "X25519", x: SECRET_JWK.x }] })).toBeUndefined()
    expect(parsePlaintextKeySharingBody({ ...body, keys: "not-an-array" })).toBeUndefined()
  })

  it("rejects documents missing id, from or to", () => {
    expect(parsePlaintextKeySharingBody({ ...body, id: "" })).toBeUndefined()
    expect(parsePlaintextKeySharingBody({ ...body, from: 42 })).toBeUndefined()
    expect(parsePlaintextKeySharingBody({ ...body, to: "buyer-wallet-address" })).toBeUndefined()
    expect(parsePlaintextKeySharingBody({ ...body, to: ["buyer-wallet-address", 7] })).toBeUndefined()
  })

  it("rejects non-objects and garbage so callers fall through to the JWE path", () => {
    expect(parsePlaintextKeySharingBody("{ not json")).toBeUndefined()
    expect(parsePlaintextKeySharingBody("")).toBeUndefined()
    expect(parsePlaintextKeySharingBody(null)).toBeUndefined()
    expect(parsePlaintextKeySharingBody(undefined)).toBeUndefined()
    expect(parsePlaintextKeySharingBody([body])).toBeUndefined()
    // A General JWE never matches: no keys array of secret JWKs.
    expect(parsePlaintextKeySharingBody({ ciphertext: "abc", recipients: [{ header: { kid: "k" } }] })).toBeUndefined()
  })
})
