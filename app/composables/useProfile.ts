import { ref } from "vue"
import { CryptoHelper } from "../services/crypto/cryptoHelper"
import { ProfileService } from "../services/profile/profileService"
import type { Profile, ProfileWriteInput, UserRole } from "../types/profile"

export function useProfile() {
  const profile = ref<Profile | null>(null)
  const isFetching = ref(false)
  const error = ref<string | null>(null)
  const profileService = new ProfileService()

  async function fetchProfile(address: string, privateKey: string): Promise<void> {
    isFetching.value = true
    error.value = null

    try {
      const fetchedProfile = await profileService.getProfile(address, privateKey)
      profile.value = fetchedProfile
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to fetch profile"
      console.error("Error fetching profile:", err)
    } finally {
      isFetching.value = false
    }
  }

  async function createProfile(
    profileData: ProfileWriteInput,
    privateKey: string
  ): Promise<void> {
    isFetching.value = true
    error.value = null

    try {
      const result = await profileService.createProfile(profileData, privateKey)
      if (result.success && result.profile) {
        profile.value = result.profile
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to create profile"
      console.error("Error creating profile:", err)
    } finally {
      isFetching.value = false
    }
  }

  async function updateProfile(
    ss58Address: string,
    profileData: ProfileWriteInput,
    privateKey: string
  ): Promise<void> {
    isFetching.value = true
    error.value = null

    try {
      const result = await profileService.updateProfile(ss58Address, profileData, privateKey)
      if (result.success && result.profile) {
        profile.value = result.profile
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to update profile"
      console.error("Error updating profile:", err)
    } finally {
      isFetching.value = false
    }
  }

  async function uploadProfileImage(
    ss58Address: string,
    imageFile: File,
    imageType: "profilePicture" | "profileBackground",
    privateKey: string
  ): Promise<void> {
    isFetching.value = true
    error.value = null

    try {
      const result = await profileService.uploadImage(ss58Address, imageFile, imageType, privateKey)
      if (result.success && result.profile) {
        profile.value = result.profile
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to upload profile image"
      console.error("Error uploading profile image:", err)
    } finally {
      isFetching.value = false
    }
  }

  return {
    profile,
    isFetching,
    error,
    fetchProfile,
    createProfile,
    updateProfile,
    uploadProfileImage
  }
}
