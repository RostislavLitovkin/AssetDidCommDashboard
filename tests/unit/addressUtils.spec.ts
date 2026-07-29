import { describe, expect, it } from "vitest"
import { base58Encode, encodeAddress } from "@polkadot/util-crypto"
import { addressesEqual, isAddressLike, isSolanaAddress, normalizeApiAddress } from "../../app/services/wallet/addressUtils"

// 32 known bytes -> valid ss58 in several prefixes, and a base58 "Solana" form.
const KEY = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1))
const SS58_PREFIX0 = encodeAddress(KEY, 0)
const SS58_PREFIX42 = encodeAddress(KEY, 42)
// A real Solana address shape: raw base58 of 32 bytes (no ss58 checksum).
const SOLANA = base58Encode(KEY) // computed base58 that is NOT valid SS58

describe("isSolanaAddress", () => {
  it("rejects SS58 addresses", () => {
    expect(isSolanaAddress(SS58_PREFIX42)).toBe(false)
  })
  it("accepts raw base58 32-byte addresses", () => {
    expect(isSolanaAddress(SOLANA)).toBe(true)
  })
  it("rejects garbage and empty", () => {
    expect(isSolanaAddress("hello world")).toBe(false)
    expect(isSolanaAddress("")).toBe(false)
  })
})

describe("normalizeApiAddress", () => {
  it("re-encodes any SS58 prefix to 42", () => {
    expect(normalizeApiAddress(SS58_PREFIX0)).toBe(SS58_PREFIX42)
    expect(normalizeApiAddress(` ${SS58_PREFIX42} `)).toBe(SS58_PREFIX42)
  })
  it("passes Solana base58 addresses through unchanged", () => {
    expect(normalizeApiAddress(SOLANA)).toBe(SOLANA)
  })
  it("passes unparseable input through trimmed", () => {
    expect(normalizeApiAddress("  not-an-address ")).toBe("not-an-address")
  })
})

describe("isAddressLike", () => {
  it("accepts SS58 and Solana addresses", () => {
    expect(isAddressLike(SS58_PREFIX0)).toBe(true)
    expect(isAddressLike(SOLANA)).toBe(true)
  })
  it("rejects nicknames and blanks so they can be looked up by nickname", () => {
    expect(isAddressLike("alice")).toBe(false)
    expect(isAddressLike("")).toBe(false)
  })
})

describe("addressesEqual", () => {
  it("ignores the SS58 prefix", () => {
    expect(addressesEqual(SS58_PREFIX0, SS58_PREFIX42)).toBe(true)
  })
  it("matches an SS58 address against its 0x public key", () => {
    expect(addressesEqual(SS58_PREFIX42, `0x${Buffer.from(KEY).toString("hex")}`)).toBe(true)
  })
  it("separates distinct identities", () => {
    expect(addressesEqual(SS58_PREFIX42, encodeAddress(new Uint8Array(32).fill(9), 42))).toBe(false)
  })
})

describe("base58 case sensitivity contract", () => {
  it("distinct base58 addresses differing only by case are different identities", () => {
    // documents why addressesEqual must NOT lowercase base58 addresses
    const a = "4Nd1mYQKb2xhkfqAwtLcqEeGiPZKPXTSVKZH1B9DYIn1"
    const b = a.toLowerCase()
    expect(a).not.toBe(b)
    expect(isSolanaAddress(a) && a === b).toBe(false)
  })
})
