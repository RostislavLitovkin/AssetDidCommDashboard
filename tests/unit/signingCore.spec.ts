import { describe, expect, it, vi } from "vitest"
import { blake2AsHex } from "@polkadot/util-crypto"
import { composeApiSignaturePayload, hashApiBody } from "../../app/services/wallet/signingCore"
import { toCSharpHashHex } from "../../app/services/profile/profileSigning"

describe("composeApiSignaturePayload", () => {
  it("composes METHOD:path:bodyHash:timestamp with the C# :o timestamp form", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T22:58:41.735Z"))

    const { payload, timestamp } = composeApiSignaturePayload("POST", "/graphql", "0xABC")

    expect(timestamp).toBe("2026-07-11T22:58:41.7350000Z")
    expect(payload).toBe("POST:/graphql:0xABC:2026-07-11T22:58:41.7350000Z")
    vi.useRealTimers()
  })

  it("supports the empty body-hash segment", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-11T22:58:41.735Z"))
    const { payload } = composeApiSignaturePayload("POST", "/api/profiles/x/image", "")
    expect(payload).toBe("POST:/api/profiles/x/image::2026-07-11T22:58:41.7350000Z")
    vi.useRealTimers()
  })
})

describe("hashApiBody", () => {
  it("returns the 0x+UPPERCASE blake2b-128 of the raw body", async () => {
    const raw = "{\"query\":\"mutation { x }\"}"
    const expected = toCSharpHashHex(blake2AsHex(raw, 128))
    expect(await hashApiBody(raw)).toBe(expected)
    expect(await hashApiBody(raw)).toMatch(/^0x[0-9A-F]{32}$/)
  })
})
