import type { Profile, ProfileInput } from "../../types/profile"

export const PROFILE_API_URL = "https://profile-api.xcavate.io"

type SignedRequest = (method: "POST" | "PUT", path: string, body: string) => Promise<HeadersInit>

function profilePath(address: string): string {
  return `/api/profiles/${encodeURIComponent(address)}`
}

function profileImagePath(address: string): string {
  return `${profilePath(address)}/image`
}

function encodeMultipartImage(image: File): Promise<{ body: Uint8Array, contentType: string, signingBody: string }> {
  const boundary = `----AssetDidComm${crypto.randomUUID().replaceAll("-", "")}`
  const fileName = image.name.replaceAll("\\", "_").replaceAll("\"", "_")
  const prefix = new TextEncoder().encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fileName}"\r\nContent-Type: ${image.type || "application/octet-stream"}\r\n\r\n`
  )
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--\r\n`)

  return image.arrayBuffer().then((buffer) => {
    const file = new Uint8Array(buffer)
    const body = new Uint8Array(prefix.length + file.length + suffix.length)
    body.set(prefix)
    body.set(file, prefix.length)
    body.set(suffix, prefix.length + file.length)

    // The API hashes the UTF-8 text it reads from the multipart request body.
    return { body, contentType: `multipart/form-data; boundary=${boundary}`, signingBody: new TextDecoder().decode(body) }
  })
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
    existing: boolean,
    signRequest: SignedRequest
  ): Promise<Profile> {
    const method = existing ? "PUT" : "POST"
    const path = existing ? profilePath(address) : "/api/profiles"
    const body = JSON.stringify({
      ss58Address: address,
      nickname: input.nickname.trim(),
      bio: input.bio.trim() || null,
      profilePicture: input.profilePicture.trim() || null,
      x25519Key: input.x25519Key.trim() || null
    })
    const headers = await signRequest(method, path, body)
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method,
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
    const multipart = await encodeMultipartImage(image)
    const headers = await signRequest("POST", path, multipart.signingBody)
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": multipart.contentType,
        ...headers
      },
      body: new Uint8Array(multipart.body).buffer
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