import { beforeAll, describe, expect, it } from "vitest"
import { blake2AsHex, cryptoWaitReady } from "@polkadot/util-crypto"
import {
  buildSignaturePayload,
  canonicalProfileJson,
  formatSignatureTimestamp,
  toCSharpHashHex
} from "../../app/services/profile/profileSigning"

// Golden vectors captured from the real XcavateProfile server code (C# `Profile.Hash`,
// `CryptoHelper.ConstructPayload`, `Utils.Bytes2HexString`, `DateTime.ToString("o")`)
// and cross-verified: a signature produced from these values passes the server's
// `SignatureValidator`. If any of these change, signing against the live API breaks.
const ADDRESS = "5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV"
const X25519 = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"

beforeAll(async () => {
  await cryptoWaitReady()
})

describe("canonicalProfileJson", () => {
  it("matches C# System.Text.Json serialization for a basic profile", () => {
    const json = canonicalProfileJson({
      ss58Address: ADDRESS,
      nickname: "testuser",
      bio: null,
      profilePicture: null,
      x25519Key: X25519
    })

    expect(json).toBe(
      `{"ss58address":"${ADDRESS}","nickname":"testuser","bio":null,"profilePicture":null,"x25519Key":"${X25519}"}`
    )
    expect(toCSharpHashHex(blake2AsHex(json, 128))).toBe("0x0FA56DCAEC629BAC437FA45FF8948E0F")
  })

  it("reproduces JavaScriptEncoder.Default escaping (accents, HTML chars, emoji)", () => {
    const json = canonicalProfileJson({
      ss58Address: ADDRESS,
      nickname: 'Amélie <b>&"x"</b>',
      bio: "line1\nline2\ttab émoji 🚀 + ' ` end",
      profilePicture: null,
      x25519Key: "0xAABB"
    })

    expect(toCSharpHashHex(blake2AsHex(json, 128))).toBe("0xE2B804A6A5D3FEE16AC8173A424A41BE")
  })
})

describe("formatSignatureTimestamp", () => {
  it("emits the C# :o form with 7 fractional digits and Z", () => {
    expect(formatSignatureTimestamp(new Date("2026-07-20T12:34:56.789Z")))
      .toBe("2026-07-20T12:34:56.7890000Z")
  })
})

describe("toCSharpHashHex", () => {
  it("prefixes 0x and uppercases, matching Utils.Bytes2HexString", () => {
    expect(toCSharpHashHex("0x0fa56dcaec629bac437fa45ff8948e0f"))
      .toBe("0x0FA56DCAEC629BAC437FA45FF8948E0F")
  })
})

describe("buildSignaturePayload", () => {
  it("produces the exact string the server hashes and verifies", () => {
    const json = canonicalProfileJson({
      ss58Address: ADDRESS,
      nickname: "testuser",
      bio: null,
      profilePicture: null,
      x25519Key: X25519
    })
    const bodyHash = toCSharpHashHex(blake2AsHex(json, 128))

    expect(buildSignaturePayload("POST", "/api/profiles", bodyHash, "2026-07-20T12:34:56.7890000Z"))
      .toBe("POST:/api/profiles:0x0FA56DCAEC629BAC437FA45FF8948E0F:2026-07-20T12:34:56.7890000Z")
  })

  it("carries an empty body-hash segment for image uploads", () => {
    expect(buildSignaturePayload("POST", `/api/profiles/${ADDRESS}/image`, "", "2026-07-20T12:34:56.7890000Z"))
      .toBe(`POST:/api/profiles/${ADDRESS}/image::2026-07-20T12:34:56.7890000Z`)
  })
})
