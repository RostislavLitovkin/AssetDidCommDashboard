import type { Profile } from "../../types/profile"

/**
 * Resolve profile-picture URLs for a set of sender addresses.
 *
 * Returns a map keyed by the *input* address. An address is present only when its
 * resolved profile has a non-empty `profilePicture`. Blank/duplicate addresses are
 * collapsed, and a lookup that throws is skipped (the caller falls back to a default).
 */
export async function resolveAvatarUrls(
  addresses: string[],
  getProfile: (address: string) => Promise<Profile | null>
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(addresses.map((a) => a.trim()).filter(Boolean)))
  const result: Record<string, string> = {}

  await Promise.all(
    unique.map(async (address) => {
      try {
        const profile = await getProfile(address)
        const picture = profile?.profilePicture?.trim()
        if (picture) {
          result[address] = picture
        }
      } catch {
        // Skip — a failed lookup falls back to the default avatar downstream.
      }
    })
  )

  return result
}
