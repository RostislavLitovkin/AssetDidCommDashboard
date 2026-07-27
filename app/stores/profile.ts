import { defineStore } from "pinia"
import type { Profile } from "../types/profile"

export type ProfileStatus = "idle" | "loading" | "ready" | "error"

/**
 * Cache of the connected wallet's own profile.
 *
 * The account-setup banners live in the app shell and therefore need this on
 * every page, while the profile editor needs to push a freshly saved profile
 * back in so the banners react to a save without waiting for a refetch.
 */
export const useProfileStore = defineStore("profile", {
  state: () => ({
    address: "",
    profile: null as Profile | null,
    status: "idle" as ProfileStatus,
    error: ""
  }),
  getters: {
    /** True only once a lookup has completed and found a profile. */
    hasAccount: (state): boolean => state.status === "ready" && state.profile !== null,
    hasNickname: (state): boolean =>
      state.status === "ready" && Boolean(state.profile?.nickname?.trim())
  },
  actions: {
    async load(
      address: string,
      fetchProfile: (address: string) => Promise<Profile | null>,
      options: { force?: boolean } = {}
    ): Promise<void> {
      const nextAddress = address.trim()
      if (!nextAddress) {
        this.reset()
        return
      }

      // A settled failure stays retryable; an in-flight or resolved lookup for
      // the same address does not need repeating.
      const isSameAddress = this.address === nextAddress
      if (!options.force && isSameAddress && (this.status === "loading" || this.status === "ready")) {
        return
      }

      if (!isSameAddress) {
        this.profile = null
      }

      this.address = nextAddress
      this.status = "loading"
      this.error = ""

      try {
        const profile = await fetchProfile(nextAddress)
        // A wallet switch while the request was in flight makes this stale.
        if (this.address !== nextAddress) {
          return
        }

        this.profile = profile
        this.status = "ready"
      } catch (error) {
        if (this.address !== nextAddress) {
          return
        }

        this.profile = null
        this.status = "error"
        this.error = error instanceof Error ? error.message : "Unable to load your profile"
      }
    },
    setProfile(address: string, profile: Profile | null): void {
      this.address = address.trim()
      this.profile = profile
      this.status = "ready"
      this.error = ""
    },
    reset(): void {
      this.address = ""
      this.profile = null
      this.status = "idle"
      this.error = ""
    }
  }
})
