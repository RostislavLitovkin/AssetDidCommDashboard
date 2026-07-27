import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { useProfileStore } from "../../app/stores/profile"
import type { Profile } from "../../app/types/profile"

function profile(overrides: Partial<Profile> = {}): Profile {
  return { ss58Address: "5Alice", nickname: null, bio: null, profilePicture: null, x25519Key: null, ...overrides }
}

describe("useProfileStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it("reports no account once a lookup comes back empty", async () => {
    const store = useProfileStore()

    await store.load("5Alice", vi.fn().mockResolvedValue(null))

    expect(store.status).toBe("ready")
    expect(store.hasAccount).toBe(false)
    expect(store.hasNickname).toBe(false)
  })

  it("reports an account without a nickname when the nickname is blank", async () => {
    const store = useProfileStore()

    await store.load("5Alice", vi.fn().mockResolvedValue(profile({ nickname: "   " })))

    expect(store.hasAccount).toBe(true)
    expect(store.hasNickname).toBe(false)
  })

  it("reports both once a nickname is set", async () => {
    const store = useProfileStore()

    await store.load("5Alice", vi.fn().mockResolvedValue(profile({ nickname: "alice" })))

    expect(store.hasAccount).toBe(true)
    expect(store.hasNickname).toBe(true)
  })

  it("claims neither an account nor a nickname before a lookup settles", () => {
    const store = useProfileStore()

    expect(store.hasAccount).toBe(false)
    expect(store.hasNickname).toBe(false)
  })

  it("does not repeat a lookup for an address it already resolved", async () => {
    const store = useProfileStore()
    const fetchProfile = vi.fn().mockResolvedValue(profile())

    await store.load("5Alice", fetchProfile)
    await store.load("5Alice", fetchProfile)

    expect(fetchProfile).toHaveBeenCalledTimes(1)
  })

  it("repeats a lookup when forced, and when the address changes", async () => {
    const store = useProfileStore()
    const fetchProfile = vi.fn().mockResolvedValue(profile())

    await store.load("5Alice", fetchProfile)
    await store.load("5Alice", fetchProfile, { force: true })
    await store.load("5Bob", fetchProfile)

    expect(fetchProfile).toHaveBeenCalledTimes(3)
    expect(store.address).toBe("5Bob")
  })

  it("retries after a failed lookup", async () => {
    const store = useProfileStore()
    const fetchProfile = vi.fn()
      .mockRejectedValueOnce(new Error("Profile API unreachable"))
      .mockResolvedValueOnce(profile({ nickname: "alice" }))

    await store.load("5Alice", fetchProfile)
    expect(store.status).toBe("error")
    expect(store.error).toBe("Profile API unreachable")
    expect(store.hasAccount).toBe(false)

    await store.load("5Alice", fetchProfile)
    expect(store.status).toBe("ready")
    expect(store.hasNickname).toBe(true)
  })

  it("drops a response that a wallet switch made stale", async () => {
    const store = useProfileStore()
    let resolveAlice: (value: Profile | null) => void = () => {}
    const alicePending = new Promise<Profile | null>((resolve) => { resolveAlice = resolve })

    const aliceLoad = store.load("5Alice", () => alicePending)
    await store.load("5Bob", vi.fn().mockResolvedValue(profile({ ss58Address: "5Bob", nickname: "bob" })))
    resolveAlice(profile({ nickname: "alice" }))
    await aliceLoad

    expect(store.address).toBe("5Bob")
    expect(store.profile?.nickname).toBe("bob")
  })

  it("clears everything when the wallet disconnects", async () => {
    const store = useProfileStore()

    await store.load("5Alice", vi.fn().mockResolvedValue(profile({ nickname: "alice" })))
    await store.load("", vi.fn())

    expect(store.status).toBe("idle")
    expect(store.profile).toBeNull()
    expect(store.address).toBe("")
  })

  it("adopts a just-saved profile without a round trip", () => {
    const store = useProfileStore()

    store.setProfile("5Alice", profile({ nickname: "alice" }))

    expect(store.status).toBe("ready")
    expect(store.address).toBe("5Alice")
    expect(store.hasAccount).toBe(true)
    expect(store.hasNickname).toBe(true)
  })
})
