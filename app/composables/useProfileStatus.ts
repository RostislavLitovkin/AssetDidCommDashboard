import { computed } from "vue"
import { useWallet } from "./useWallet"
import { ProfileClient } from "../services/profile/profileClient"
import { useProfileStore } from "../stores/profile"
import type { Profile } from "../types/profile"

/**
 * Whether the connected wallet has an account yet, and whether that account is
 * still missing a nickname. Backed by a shared store, so the app-shell banners
 * and the profile pages agree without each running their own lookup.
 */
export function useProfileStatus() {
  const wallet = useWallet()
  const store = useProfileStore()
  const runtimeConfig = useRuntimeConfig()
  const profileClient = new ProfileClient(String(runtimeConfig.public.profileApiUrl))

  async function refresh(options: { force?: boolean } = {}): Promise<void> {
    await store.load(
      wallet.accountAddress.value || "",
      (address) => profileClient.getProfile(address),
      options
    )
  }

  /** Adopts a profile the caller just wrote, skipping the round trip. */
  function setProfile(profile: Profile | null): void {
    store.setProfile(wallet.accountAddress.value || "", profile)
  }

  return {
    address: computed(() => wallet.accountAddress.value || ""),
    hasConnectedWallet: computed(() => Boolean(wallet.accountAddress.value)),
    profile: computed(() => store.profile),
    status: computed(() => store.status),
    error: computed(() => store.error),
    hasAccount: computed(() => store.hasAccount),
    hasNickname: computed(() => store.hasNickname),
    refresh,
    setProfile
  }
}
