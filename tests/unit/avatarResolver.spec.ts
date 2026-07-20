import { describe, expect, it, vi } from "vitest"
import { resolveAvatarUrls, toSs58Prefix42 } from "../../app/services/profile/avatarResolver"
import type { Profile } from "../../app/types/profile"

function profile(overrides: Partial<Profile>): Profile {
  return { ss58Address: "5Example", nickname: null, bio: null, profilePicture: null, x25519Key: null, ...overrides }
}

describe("resolveAvatarUrls", () => {
  it("maps each address to its non-empty profile picture, keyed by the input address", async () => {
    const getProfile = vi.fn(async (address: string) =>
      address === "addrA" ? profile({ profilePicture: "https://pics.test/a.png" }) : null
    )

    await expect(resolveAvatarUrls(["addrA", "addrB"], getProfile)).resolves.toEqual({
      addrA: "https://pics.test/a.png"
    })
  })

  it("dedupes addresses and skips blanks", async () => {
    const getProfile = vi.fn(async () => profile({ profilePicture: "https://pics.test/x.png" }))

    await resolveAvatarUrls(["addrA", " addrA ", "", "  "], getProfile)

    expect(getProfile).toHaveBeenCalledTimes(1)
    expect(getProfile).toHaveBeenCalledWith("addrA")
  })

  it("skips addresses whose lookup throws", async () => {
    const getProfile = vi.fn(async (address: string) => {
      if (address === "boom") throw new Error("network")
      return profile({ profilePicture: "https://pics.test/ok.png" })
    })

    await expect(resolveAvatarUrls(["boom", "ok"], getProfile)).resolves.toEqual({
      ok: "https://pics.test/ok.png"
    })
  })

  it("skips profiles with a null or blank picture", async () => {
    const getProfile = vi.fn(async (address: string) =>
      address === "blank" ? profile({ profilePicture: "  " }) : profile({ profilePicture: null })
    )

    await expect(resolveAvatarUrls(["blank", "none"], getProfile)).resolves.toEqual({})
  })
})

describe("toSs58Prefix42", () => {
  it("is idempotent on a generic (prefix-42) address", () => {
    const alice = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
    expect(toSs58Prefix42(alice)).toBe(alice)
  })

  it("returns the input unchanged when it is not a valid address", () => {
    expect(toSs58Prefix42("not-an-address")).toBe("not-an-address")
  })
})
