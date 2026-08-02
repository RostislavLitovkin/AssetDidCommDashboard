import { describe, expect, it } from "vitest"
import {
  latestKeySharingMessage,
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
