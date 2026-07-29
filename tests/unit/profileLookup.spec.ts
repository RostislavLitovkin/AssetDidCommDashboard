import { describe, expect, it, vi } from "vitest"
import { base58Encode, encodeAddress } from "@polkadot/util-crypto"
import { profileLookupKind, resolveProfileByAddressOrNickname } from "../../app/services/profile/profileLookup"
import type { Profile } from "../../app/types/profile"

const KEY = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1))
const SS58_PREFIX0 = encodeAddress(KEY, 0)
const SS58_PREFIX42 = encodeAddress(KEY, 42)
const SOLANA = base58Encode(KEY)

const PROFILE: Profile = {
  ss58Address: SS58_PREFIX42,
  nickname: "alice",
  bio: null,
  profilePicture: null,
  x25519Key: null
}

function fakeClient(overrides: {
  getProfile?: (address: string) => Promise<Profile | null>
  getProfileByNickname?: (nickname: string) => Promise<Profile | null>
} = {}) {
  return {
    getProfile: vi.fn(overrides.getProfile ?? (async () => null)),
    getProfileByNickname: vi.fn(overrides.getProfileByNickname ?? (async () => null))
  }
}

describe("profileLookupKind", () => {
  it("treats SS58 and Solana addresses as addresses", () => {
    expect(profileLookupKind(SS58_PREFIX0)).toBe("address")
    expect(profileLookupKind(SOLANA)).toBe("address")
  })
  it("treats everything else as a nickname", () => {
    expect(profileLookupKind("alice")).toBe("nickname")
    expect(profileLookupKind("5NotAnAddress!")).toBe("nickname")
  })
})

describe("resolveProfileByAddressOrNickname", () => {
  it("looks an address up by its prefix-42 form", async () => {
    const client = fakeClient({ getProfile: async () => PROFILE })

    const result = await resolveProfileByAddressOrNickname(client, ` ${SS58_PREFIX0} `)

    expect(result).toEqual({ kind: "address", profile: PROFILE })
    expect(client.getProfile).toHaveBeenCalledWith(SS58_PREFIX42)
    expect(client.getProfileByNickname).not.toHaveBeenCalled()
  })

  it("looks a nickname up by nickname", async () => {
    const client = fakeClient({ getProfileByNickname: async () => PROFILE })

    const result = await resolveProfileByAddressOrNickname(client, " alice ")

    expect(result).toEqual({ kind: "nickname", profile: PROFILE })
    expect(client.getProfileByNickname).toHaveBeenCalledWith("alice")
    expect(client.getProfile).not.toHaveBeenCalled()
  })

  it("reports a missing nickname without falling back to an address lookup", async () => {
    const client = fakeClient()

    const result = await resolveProfileByAddressOrNickname(client, "ghost")

    expect(result).toEqual({ kind: "nickname", profile: null })
    expect(client.getProfile).not.toHaveBeenCalled()
  })

  it("queries nothing for a blank value", async () => {
    const client = fakeClient()

    const result = await resolveProfileByAddressOrNickname(client, "   ")

    expect(result.profile).toBeNull()
    expect(client.getProfile).not.toHaveBeenCalled()
    expect(client.getProfileByNickname).not.toHaveBeenCalled()
  })
})
