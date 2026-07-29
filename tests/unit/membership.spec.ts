import { describe, expect, it } from "vitest"
import { encodeAddress } from "@polkadot/util-crypto"
import { rolesGrantedBy, rolesHeld } from "../../app/services/buckets/membership"

const KEY = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1))
const SS58_PREFIX0 = encodeAddress(KEY, 0)
const SS58_PREFIX42 = encodeAddress(KEY, 42)
const OTHER = encodeAddress(new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 100)), 42)

// A valid base64url JWK "x" (32 bytes) and the same key as 0x-prefixed hex.
const VIEWER_JWK_X = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA"
const VIEWER_HEX = "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"

describe("rolesGrantedBy", () => {
  it("expands admin to the contributor and viewer roles it also grants", () => {
    expect(rolesGrantedBy("admin")).toEqual(["admin", "contributor", "viewer"])
  })
  it("expands contributor to the viewer role it also grants", () => {
    expect(rolesGrantedBy("contributor")).toEqual(["contributor", "viewer"])
  })
  it("leaves viewer alone", () => {
    expect(rolesGrantedBy("viewer")).toEqual(["viewer"])
  })
})

describe("rolesHeld", () => {
  const lists = { admins: [SS58_PREFIX0], contributors: [SS58_PREFIX0], viewers: [VIEWER_HEX] }

  it("matches admins and contributors across SS58 prefixes", () => {
    expect(rolesHeld({ address: SS58_PREFIX42 }, lists)).toEqual(["admin", "contributor"])
  })

  it("matches viewers by X25519 key rather than by address", () => {
    // Viewers are keyed on-chain by encryption key; the address is not in the list.
    expect(rolesHeld({ address: OTHER, x25519Key: VIEWER_JWK_X }, lists)).toEqual(["viewer"])
  })

  it("normalizes both sides of the viewer comparison", () => {
    // Profile stores base64url, the chain list stores hex — same key, still a match.
    expect(rolesHeld({ address: SS58_PREFIX42, x25519Key: VIEWER_HEX }, lists))
      .toEqual(["admin", "contributor", "viewer"])
  })

  it("reports no viewer role when the profile has no usable key", () => {
    expect(rolesHeld({ address: SS58_PREFIX42, x25519Key: "not-a-key" }, lists))
      .toEqual(["admin", "contributor"])
    expect(rolesHeld({ address: SS58_PREFIX42 }, lists)).toEqual(["admin", "contributor"])
  })

  it("returns nothing for a non-member and for a blank address", () => {
    expect(rolesHeld({ address: OTHER }, lists)).toEqual([])
    expect(rolesHeld({ address: "   " }, lists)).toEqual([])
  })
})
