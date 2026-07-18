<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import { useRoute } from "vue-router"
import { useProfile } from "../../../composables/useProfile"
import { useAddress } from "../../../composables/useAddress"
import type { Profile, ProfileWriteInput } from "../types/profile"

const route = useRoute()

const ss58Address = computed(() => String(route.params.ss58Address))
const { formatAddress } = useAddress()
const { profile, isFetching, error, updateProfile, uploadProfileImage } = useProfile()
const currentProfile = ref<Profile | null>(null)

// Form state
const firstName = ref("")
const lastName = ref("")
const email = ref("")
const phoneNumber = ref("")
const profilePicture = ref<string | null>(null)
const profileBackground = ref<string | null>(null)

const formattedAddress = computed(() => 
  ss58Address.value ? formatAddress(ss58Address.value) : ""
)

// Profile picture and background
const profilePictureUrl = computed(() => 
  profilePicture.value || currentProfile.value?.profilePicture || ""
)
const profileBackgroundUrl = computed(() => 
  profileBackground.value || currentProfile.value?.profileBackground || ""
)

// Validation
const saveButtonState = computed(() => {
  const isValid = 
    firstName.value.trim() !== "" &&
    lastName.value.trim() !== "" &&
    isValidEmail(email.value) &&
    phoneNumber.value.trim() !== ""
  return isValid ? "enabled" : "disabled"
})

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

async function loadProfile() {
  if (ss58Address.value) {
    const privateKey = await getPrivateKeyFromWallet()
    if (privateKey) {
      await updateProfile(ss58Address.value, { ss58Address: ss58Address.value }, privateKey)
    }
  }
}

// Get private key from wallet
async function getPrivateKeyFromWallet(): Promise<string> {
  // This would be implemented with wallet integration
  // For now, return a placeholder
  return ""
}

// Form submission
async function handleSave() {
  if (ss58Address.value) {
    const privateKey = await getPrivateKeyFromWallet()
    if (privateKey) {
      const profileData: ProfileWriteInput = {
        firstName: firstName.value.trim(),
        lastName: lastName.value.trim(),
        email: email.value.trim(),
        phoneNumber: phoneNumber.value.trim(),
        profilePicture: profilePicture.value || undefined,
        profileBackground: profileBackground.value || undefined
      }
      
      await updateProfile(ss58Address.value, profileData, privateKey)
    }
  }
}

// Image upload handlers
async function handlePickProfilePicture(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files && input.files[0]) {
    const file = input.files[0]
    
    // Convert to data URL for preview
    const reader = new FileReader()
    reader.onload = (e) => {
      profilePicture.value = e.target?.result as string
    }
    reader.readAsDataURL(file)
    
    // Upload to server
    if (ss58Address.value) {
      const privateKey = await getPrivateKeyFromWallet()
      if (privateKey) {
        await uploadProfileImage(ss58Address.value, file, "profilePicture", privateKey)
      }
    }
  }
}

async function handlePickProfileBackground(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files && input.files[0]) {
    const file = input.files[0]
    
    // Convert to data URL for preview
    const reader = new FileReader()
    reader.onload = (e) => {
      profileBackground.value = e.target?.result as string
    }
    reader.readAsDataURL(file)
    
    // Upload to server
    if (ss58Address.value) {
      const privateKey = await getPrivateKeyFromWallet()
      if (privateKey) {
        await uploadProfileImage(ss58Address.value, file, "profileBackground", privateKey)
      }
    }
  }
}

// Initialize form with profile data
function initializeForm() {
  if (currentProfile.value) {
    firstName.value = currentProfile.value.firstName || ""
    lastName.value = currentProfile.value.lastName || ""
    email.value = currentProfile.value.email || ""
    phoneNumber.value = currentProfile.value.phoneNumber || ""
    profilePicture.value = currentProfile.value.profilePicture || null
    profileBackground.value = currentProfile.value.profileBackground || null
  }
}

onMounted(() => {
  loadProfile()
  initializeForm()
})
</script>

<template>
  <div class="profile-edit-container">
    <!-- Header -->
    <div class="profile-edit-header">
      <h1>Modify Personal Profile</h1>
      <p class="subtitle">Update your personal information</p>
    </div>

    <!-- Profile Picture & Background -->
    <div class="profile-edit-section">
      <div class="image-upload-container">
        <!-- Profile Background -->
        <div class="image-upload-section">
          <label class="image-upload-label">Profile Background</label>
          <div 
            class="image-preview-box"
            :style="{ backgroundImage: profileBackground ? `url(${profileBackground})` : 'none' }"
          >
            <div class="overlay">
              <span class="camera-icon">📷</span>
              <span class="button-text">Click to upload</span>
            </div>
            <input
              type="file"
              accept="image/*"
              @change="handlePickProfileBackground"
              class="file-input"
            />
          </div>
        </div>

        <!-- Profile Picture -->
        <div class="image-upload-section">
          <label class="image-upload-label">Profile Picture</label>
          <div 
            class="avatar-preview-box"
            :style="{ backgroundImage: profilePicture ? `url(${profilePicture})` : 'none' }"
          >
            <div class="overlay">
              <span class="camera-icon">📷</span>
              <span class="button-text">Click to upload</span>
            </div>
            <input
              type="file"
              accept="image/*"
              @change="handlePickProfilePicture"
              class="file-input"
            />
          </div>
        </div>
      </div>

      <!-- Personal Information Form -->
      <div class="form-section">
        <div class="form-group">
          <label class="form-label">First Name</label>
          <input
            v-model="firstName"
            type="text"
            placeholder="Enter your first name"
            class="form-input"
          />
        </div>

        <div class="form-group">
          <label class="form-label">Last Name</label>
          <input
            v-model="lastName"
            type="text"
            placeholder="Enter your last name"
            class="form-input"
          />
        </div>

        <div class="form-group">
          <label class="form-label">Email</label>
          <input
            v-model="email"
            type="email"
            placeholder="Enter your email"
            class="form-input"
          />
        </div>

        <div class="form-group">
          <label class="form-label">Phone Number</label>
          <input
            v-model="phoneNumber"
            type="tel"
            placeholder="Enter your phone number"
            class="form-input"
          />
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="profile-edit-actions">
      <button 
        class="btn btn-secondary" 
        @click="$router.go(-1)"
      >
        Cancel
      </button>
      <button 
        class="btn btn-primary"
        :class="{ 'btn-disabled': saveButtonState === 'disabled' }"
        @click="handleSave"
        :disabled="saveButtonState === 'disabled'"
      >
        Save Profile
      </button>
    </div>
  </div>
</template>

<style scoped>
.profile-edit-container {
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
}

.profile-edit-header {
  margin-bottom: 24px;
}

.profile-edit-header h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 14px;
  margin: 0;
}

/* Image Upload Section */
.profile-edit-section {
  background: var(--card-bg);
  padding: 24px;
  border-radius: 12px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.image-upload-container {
  display: flex;
  gap: 20px;
  margin-bottom: 32px;
}

.image-upload-section {
  flex: 1;
}

.image-upload-label {
  display: block;
  margin-bottom: 12px;
  font-weight: 500;
  color: var(--text-primary);
}

.image-preview-box {
  width: 100%;
  height: 160px;
  background-size: cover;
  background-position: center;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  transition: all 0.2s;
}

.image-preview-box:hover {
  transform: scale(1.02);
}

.avatar-preview-box {
  width: 120px;
  height: 120px;
  min-width: 120px;
  min-height: 120px;
  background-size: cover;
  background-position: center;
  border-radius: 50%;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  transition: all 0.2s;
  border: 4px solid var(--border-color);
}

.avatar-preview-box:hover {
  transform: scale(1.05);
  border-color: var(--color-primary);
}

.overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.image-preview-box:hover .overlay,
.avatar-preview-box:hover .overlay {
  opacity: 1;
}

.camera-icon {
  font-size: 24px;
  color: white;
  margin-bottom: 8px;
}

.button-text {
  color: white;
  font-size: 14px;
}

.file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

/* Form Section */
.form-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  font-weight: 500;
  color: var(--text-primary);
  font-size: 14px;
}

.form-input {
  padding: 12px 16px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.2s;
  background: var(--bg-color);
  color: var(--text-primary);
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

/* Action Buttons */
.profile-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 16px;
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--border-color);
}

.btn {
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
  border: none;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-primary-dark);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--btn-secondary-bg);
  color: var(--btn-secondary-color);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover {
  background: var(--btn-secondary-hover-bg);
}

.btn-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Responsive */
@media (max-width: 640px) {
  .image-upload-container {
    flex-direction: column;
  }
  
  .avatar-preview-box {
    align-self: center;
  }
}
</style>
