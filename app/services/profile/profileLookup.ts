/**
 * Resolves what a user typed into the member field — an SS58/Solana address or
 * a profile nickname — to a profile, reporting which kind it decided on so the
 * caller can phrase "not found" for the right thing.
 */
import type { ProfileClient } from "./profileClient"
import type { Profile } from "../../types/profile"
import { isAddressLike, normalizeApiAddress } from "../wallet/addressUtils"

export type ProfileLookupKind = "address" | "nickname"

export interface ProfileLookupResult {
  kind: ProfileLookupKind
  profile: Profile | null
}

export function profileLookupKind(value: string): ProfileLookupKind {
  return isAddressLike(value) ? "address" : "nickname"
}

export async function resolveProfileByAddressOrNickname(
  client: Pick<ProfileClient, "getProfile" | "getProfileByNickname">,
  value: string
): Promise<ProfileLookupResult> {
  const trimmed = value.trim()
  const kind = profileLookupKind(trimmed)

  if (!trimmed) {
    return { kind, profile: null }
  }

  const profile = kind === "address"
    ? await client.getProfile(normalizeApiAddress(trimmed))
    : await client.getProfileByNickname(trimmed)

  return { kind, profile }
}
