import type { Profile, ProfileWriteInput, ProfileWriteResult } from "../types/profile"
import { CryptoHelper } from "../crypto/cryptoHelper"

const PROFILE_API_BASE_URL = "https://profile-api.xcavate.io"

export interface ProfileServiceOptions {
  baseUrl?: string
}

export class ProfileService {
  private baseUrl: string

  constructor(options: ProfileServiceOptions = {}) {
    this.baseUrl = options.baseUrl || PROFILE_API_BASE_URL
  }

  private async constructPayload(
    method: string,
    path: string,
    body: unknown,
    timestamp: Date
  ): Promise<{ payload: string; bodyHash: string }> {
    const bodyJson = JSON.stringify(body)
    const bodyHash = await CryptoHelper.computeBlake2bHash(bodyJson)
    const payload = CryptoHelper.constructPayload(method, path, bodyHash, timestamp)
    return { payload, bodyHash }
  }

  private async signPayload(
    payload: string,
    privateKey: string
  ): Promise<{ signature: string; address: string }> {
    // Convert private key string to Uint8Array if needed
    const privateKeyBytes = new Uint8Array(JSON.parse(privateKey))
    return await CryptoHelper.signPayload(payload, privateKeyBytes)
  }

  private async createRequestHeaders(
    method: string,
    path: string,
    body: unknown,
    privateKey: string
  ): Promise<Record<string, string>> {
    const timestamp = new Date()
    const { payload, bodyHash } = await this.constructPayload(method, path, body, timestamp)
    const { signature, address } = await this.signPayload(payload, privateKey)

    return {
      "X-SS58-Address": address,
      "X-Signature": signature,
      "X-Timestamp": timestamp.toISOString(),
      "X-Body-Hash": bodyHash
    }
  }

  async getProfiles(privateKey: string): Promise<Profile[]> {
    const headers = await this.createRequestHeaders("GET", "/api/profiles", {}, privateKey)
    const response = await fetch(`${this.baseUrl}/api/profiles`, {
      method: "GET",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch profiles: ${response.status}`)
    }

    return await response.json()
  }

  async getProfile(ss58Address: string, privateKey: string): Promise<Profile | null> {
    const headers = await this.createRequestHeaders("GET", `/api/profiles/${ss58Address}`, {}, privateKey)
    const response = await fetch(`${this.baseUrl}/api/profiles/${ss58Address}`, {
      method: "GET",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      }
    })

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch profile: ${response.status}`)
    }

    return await response.json()
  }

  async createProfile(
    profile: ProfileWriteInput,
    privateKey: string
  ): Promise<ProfileWriteResult> {
    const headers = await this.createRequestHeaders("POST", "/api/profiles", profile, privateKey)
    
    const response = await fetch(`${this.baseUrl}/api/profiles`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(profile)
    })

    if (!response.ok) {
      throw new Error(`Failed to create profile: ${response.status}`)
    }

    const createdProfile = await response.json()
    return {
      success: true,
      message: "Profile created successfully",
      profile: createdProfile
    }
  }

  async updateProfile(
    ss58Address: string,
    profile: ProfileWriteInput,
    privateKey: string
  ): Promise<ProfileWriteResult> {
    const headers = await this.createRequestHeaders("PUT", `/api/profiles/${ss58Address}`, profile, privateKey)
    
    const response = await fetch(`${this.baseUrl}/api/profiles/${ss58Address}`, {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(profile)
    })

    if (!response.ok) {
      throw new Error(`Failed to update profile: ${response.status}`)
    }

    const updatedProfile = await response.json()
    return {
      success: true,
      message: "Profile updated successfully",
      profile: updatedProfile
    }
  }

  async deleteProfile(ss58Address: string, privateKey: string): Promise<ProfileWriteResult> {
    const headers = await this.createRequestHeaders("DELETE", `/api/profiles/${ss58Address}`, {}, privateKey)
    
    const response = await fetch(`${this.baseUrl}/api/profiles/${ss58Address}`, {
      method: "DELETE",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to delete profile: ${response.status}`)
    }

    return {
      success: true,
      message: "Profile deleted successfully"
    }
  }

  async uploadImage(
    ss58Address: string,
    imageFile: File,
    imageType: "profilePicture" | "profileBackground",
    privateKey: string
  ): Promise<ProfileWriteResult> {
    const formData = new FormData()
    formData.append("image", imageFile)

    // For image upload, we need special handling
    const timestamp = new Date()
    const bodyHash = await CryptoHelper.computeBlake2bHash("") // Empty body for multipart
    const payload = CryptoHelper.constructPayload("POST", `/api/profiles/${ss58Address}/image`, bodyHash, timestamp)
    const { signature, address } = await this.signPayload(payload, privateKey)

    const response = await fetch(
      `${this.baseUrl}/api/profiles/${ss58Address}/image?` +
      `X-SS58-Address=${encodeURIComponent(address)}&` +
      `X-Signature=${encodeURIComponent(signature)}&` +
      `X-Timestamp=${encodeURIComponent(timestamp.toISOString())}`,
      {
        method: "POST",
        body: formData
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to upload image: ${response.status}`)
    }

    const result = await response.json()
    return {
      success: true,
      message: "Image uploaded successfully",
      profile: result as Profile
    }
  }
}
