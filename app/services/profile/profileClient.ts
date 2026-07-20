import type { Profile, ProfileInput } from "../../types/profile"
import { canonicalProfileJson, type ProfilePayloadBody } from "./profileSigning"

export const PROFILE_API_URL = "https://profile-api.xcavate.io"

type SignedRequest = (method: "POST" | "PUT", path: string, body: ProfilePayloadBody) => Promise<HeadersInit>

function profilePath(address: string): string {
  return `/api/profiles/${encodeURIComponent(address)}`
}

function profileImagePath(address: string): string {
  return `${profilePath(address)}/image`
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

export function normalizeProfile(value: unknown): Profile {
  if (!value || typeof value !== "object") {
    throw new Error("Profile API returned an invalid profile")
  }

  const profile = value as Record<string, unknown>
  const ss58Address = asOptionalString(profile.ss58Address ?? profile.ss58address)
  if (!ss58Address) {
    throw new Error("Profile API returned a profile without an SS58 address")
  }

  return {
    ss58Address,
    nickname: asOptionalString(profile.nickname),
    bio: asOptionalString(profile.bio),
    profilePicture: asOptionalString(profile.profilePicture),
    x25519Key: asOptionalString(profile.x25519Key)
  }
}

export class ProfileClient {
  constructor(
    private readonly baseUrl = PROFILE_API_URL,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)
  ) {}

  async getProfile(address: string): Promise<Profile | null> {
    const response = await this.fetcher(`${this.baseUrl}${profilePath(address)}`)
    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      throw new Error(`Unable to load profile (${response.status})`)
    }

    return normalizeProfile(await response.json())
  }

  async getProfileByNickname(nickname: string): Promise<Profile | null> {
    const response = await this.fetcher(`${this.baseUrl}/api/profiles/nickname/${encodeURIComponent(nickname)}`)
    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      throw new Error(`Unable to check nickname (${response.status})`)
    }

    return normalizeProfile(await response.json())
  }

  async saveProfile(
    address: string,
    input: ProfileInput,
    signRequest: SignedRequest
  ): Promise<Profile> {
    // PUT is an upsert (creates the profile when absent), matching the mobile app
    // which always registers via PUT /api/profiles/{address}.
    const path = profilePath(address)
    const body = canonicalProfileJson({
      ss58Address: address,
      nickname: input.nickname.trim() || null,
      bio: input.bio.trim() || null,
      profilePicture: input.profilePicture.trim() || null,
      x25519Key: input.x25519Key.trim() || null
    })
    const headers = await signRequest("PUT", path, { kind: "json", canonicalJson: body })
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...headers
      },
      body
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Unable to save profile (${response.status})`)
    }

    return normalizeProfile(await response.json())
  }

  async uploadProfileImage(address: string, image: File, signRequest: SignedRequest): Promise<string> {
    const path = profileImagePath(address)
    // The API signs an EmptyPayloadBody for image uploads (hash of ""), so the
    // multipart content is irrelevant to the signature — let the browser build it.
    const headers = await signRequest("POST", path, { kind: "empty" })
    const form = new FormData()
    form.append("image", image, image.name)
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: form
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Unable to upload profile image (${response.status})`)
    }

    const url = (await response.text()).trim()
    if (!url) {
      throw new Error("Profile API returned an empty image URL")
    }

    return url
  }
}