import { describe, expect, it } from "vitest"
import {
  isFileMessage,
  KEY_SHARING_CONTENT_TYPE,
  KEY_SHARING_MESSAGE_TAG,
  normalizeFixed32ByteKey,
  normalizeX25519ToJwkX,
  sha256HexUtf8,
  TEXT_CONTENT_TYPE
} from "../../app/services/buckets/valueCodecs"

describe("normalizeFixed32ByteKey", () => {
  it("passes through 0x-prefixed 32-byte hex", () => {
    const hex = "0x" + "ab".repeat(32)
    expect(normalizeFixed32ByteKey(hex).toLowerCase()).toBe(hex)
  })

  it("decodes a 43-char base64url JWK x value to 0x hex", () => {
    // base64url of 32 bytes 0x00..0x1f
    const x = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
    const result = normalizeFixed32ByteKey(x)
    expect(result.toLowerCase()).toBe(
      "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
    )
  })

  it("rejects values that are not 32 bytes", () => {
    expect(() => normalizeFixed32ByteKey("abc")).toThrow()
  })
})

describe("normalizeX25519ToJwkX", () => {
  const base64UrlX = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"

  it("passes through a 43-char base64url value unchanged", () => {
    expect(normalizeX25519ToJwkX(base64UrlX)).toBe(base64UrlX)
  })

  it("converts 0x-prefixed 64-char hex to the equivalent base64url value", () => {
    const hex = "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
    expect(normalizeX25519ToJwkX(hex)).toBe(base64UrlX)
  })

  it("converts hex without a 0x prefix to the equivalent base64url value", () => {
    const hex = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
    expect(normalizeX25519ToJwkX(hex)).toBe(base64UrlX)
  })

  it("returns null for values that are neither hex nor a 32-byte base64url key", () => {
    expect(normalizeX25519ToJwkX("hello world")).toBeNull()
  })
})

describe("sha256HexUtf8", () => {
  it("hashes utf-8 text to 0x-prefixed sha256", async () => {
    // echo -n "hello" | sha256sum
    expect(await sha256HexUtf8("hello")).toBe(
      "0x2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    )
  })
})

describe("isFileMessage", () => {
  it("rejects key-sharing tag regardless of content type", () => {
    expect(isFileMessage({ contentType: "image/png", tag: KEY_SHARING_MESSAGE_TAG })).toBe(false)
  })
  it("rejects text and key-sharing content types", () => {
    expect(isFileMessage({ contentType: TEXT_CONTENT_TYPE, tag: null })).toBe(false)
    expect(isFileMessage({ contentType: KEY_SHARING_CONTENT_TYPE, tag: null })).toBe(false)
    expect(isFileMessage({ contentType: null, tag: null })).toBe(false)
  })
  it("accepts real file content types", () => {
    expect(isFileMessage({ contentType: "image/png", tag: null })).toBe(true)
  })
})
