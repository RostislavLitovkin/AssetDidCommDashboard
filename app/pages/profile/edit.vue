<script setup lang="ts">
import { ArrowLeft, ImageUp, Save, UserRound } from "lucide-vue-next"
import { computed, onMounted, ref, watch } from "vue"
import { useRouter } from "vue-router"
import { useWallet } from "../../composables/useWallet"
import { ProfileClient } from "../../services/profile/profileClient"
import { resizeProfileImage } from "../../services/profile/imageResize"
import { useSettingsStore } from "../../stores/settings"
import PageHeader from "../../components/common/PageHeader.vue"

const wallet = useWallet()
const settings = useSettingsStore()
const router = useRouter()
const profileClient = new ProfileClient()
const loading = ref(false)
const saving = ref(false)
const profileExists = ref(false)
const originalNickname = ref("")
const nickname = ref("")
const bio = ref("")
const profilePicture = ref("")
const selectedImage = ref<File | null>(null)
const x25519Key = ref("")
const error = ref("")
const nicknameError = ref("")
const nicknameChecking = ref(false)
const nicknameAvailable = ref(false)
const hasConnectedWallet = computed(() => Boolean(wallet.accountAddress.value))
const isFormValid = computed(() => nickname.value.trim().length > 0 && !nicknameError.value)

async function loadProfile(): Promise<void> {
  const address = wallet.accountAddress.value
  error.value = ""
  if (!address) return

  loading.value = true
  try {
    const profile = await profileClient.getProfile(address)
    profileExists.value = Boolean(profile)
    originalNickname.value = profile?.nickname || ""
    nickname.value = profile?.nickname || ""
    bio.value = profile?.bio || ""
    profilePicture.value = profile?.profilePicture || ""
    x25519Key.value = profile?.x25519Key || settings.x25519SecretJwk?.x || ""
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : "Unable to load profile"
  } finally {
    loading.value = false
  }
}

async function validateNickname(): Promise<void> {
  const requestedNickname = nickname.value.trim()
  nicknameError.value = ""
  nicknameAvailable.value = false
  if (!requestedNickname || requestedNickname === originalNickname) return

  nicknameChecking.value = true
  try {
    const existingProfile = await profileClient.getProfileByNickname(requestedNickname)
    if (existingProfile && existingProfile.ss58Address !== wallet.accountAddress.value) {
      nicknameError.value = "This nickname is already in use."
    } else {
      nicknameAvailable.value = true
    }
  } catch (validationError) {
    nicknameError.value = validationError instanceof Error ? validationError.message : "Unable to check nickname"
  } finally {
    nicknameChecking.value = false
  }
}

async function saveProfile(): Promise<void> {
  error.value = ""
  await validateNickname()
  if (!isFormValid.value || !wallet.accountAddress.value) {
    if (!wallet.accountAddress.value) error.value = "Connect a wallet before saving your profile."
    return
  }

  saving.value = true
  try {
    await profileClient.saveProfile(wallet.accountAddress.value, {
      nickname: nickname.value,
      bio: bio.value,
      profilePicture: profilePicture.value,
      x25519Key: x25519Key.value
    }, wallet.signProfileRequest)
    if (selectedImage.value) {
      // The profile must exist before the image endpoint accepts an upload, so
      // this runs after saveProfile. Resize to a small square JPEG to avoid 413s.
      const resized = await resizeProfileImage(selectedImage.value, wallet.accountAddress.value)
      profilePicture.value = await profileClient.uploadProfileImage(
        wallet.accountAddress.value,
        resized,
        wallet.signProfileRequest
      )
    }
    await router.push("/profile")
  } catch (saveError) {
    error.value = saveError instanceof Error ? saveError.message : "Unable to save profile"
  } finally {
    saving.value = false
  }
}

function selectImage(event: Event): void {
  const input = event.target as HTMLInputElement
  selectedImage.value = input.files?.[0] || null
}

watch(() => wallet.accountAddress.value, loadProfile)
onMounted(() => {
  settings.initialize()
  loadProfile()
})
</script>

<template>
  <main class="profile-edit-page stack">
    <PageHeader
      :title="profileExists ? 'Edit profile' : 'Create profile'"
      subtitle="Manage the public profile for your connected wallet."
    >
      <template #actions>
        <NuxtLink class="btn icon-button" to="/profile" aria-label="Back to profile" title="Back to profile">
          <ArrowLeft :size="18" />
        </NuxtLink>
      </template>
    </PageHeader>

    <section v-if="!hasConnectedWallet" class="card profile-edit-empty stack">
      <UserRound :size="28" aria-hidden="true" />
      <h4>Connect a wallet to create a profile</h4>
      <NuxtLink class="btn" to="/profile">Back to profile</NuxtLink>
    </section>

    <section v-else-if="loading" class="card profile-edit-empty"><span class="muted">Loading profile...</span></section>

    <form v-else class="card profile-form stack" @submit.prevent="saveProfile">
      <label class="stack field">
        <span>Wallet address</span>
        <input class="input" :value="wallet.accountAddress.value" readonly />
      </label>
      <label class="stack field">
        <span>Nickname <strong>*</strong></span>
        <input v-model="nickname" class="input" maxlength="64" required autocomplete="nickname" @blur="validateNickname" />
        <small v-if="nicknameChecking" class="muted">Checking nickname...</small>
        <small v-else-if="nicknameError" class="field-error">{{ nicknameError }}</small>
        <small v-else-if="nicknameAvailable" class="field-success">This nickname is available.</small>
      </label>
      <label class="stack field">
        <span>Bio</span>
        <textarea v-model="bio" class="input" rows="5" maxlength="1000" />
      </label>
      <label class="stack field">
        <span>Profile picture</span>
        <span class="image-input-row">
          <ImageUp :size="18" aria-hidden="true" />
          <input class="input" type="file" accept="image/*" @change="selectImage" />
        </span>
        <small v-if="selectedImage" class="muted">{{ selectedImage.name }}</small>
        <small v-else-if="profilePicture" class="muted">Keep the current image unless you select a replacement.</small>
      </label>
      <label class="stack field">
        <span>X25519 public key</span>
        <textarea v-model="x25519Key" class="input" rows="3" />
      </label>
      <p v-if="error" class="form-error" aria-live="polite">{{ error }}</p>
      <div class="profile-form-actions">
        <NuxtLink class="btn" to="/profile">Cancel</NuxtLink>
        <button class="btn btn-primary profile-save" type="submit" :disabled="saving || nicknameChecking || !isFormValid">
          <Save :size="16" />
          {{ saving ? "Saving..." : profileExists ? "Save changes" : "Create profile" }}
        </button>
      </div>
    </form>
  </main>
</template>

<style scoped>
.profile-edit-page { max-width: 760px; }
.profile-edit-empty h4 { margin: 0; }
.icon-button { display: inline-grid; place-items: center; width: 38px; height: 38px; padding: 0; }
.profile-edit-empty { align-items: flex-start; padding: 28px; }
.profile-form { gap: 18px; }
.field { gap: 6px; }
.field > span { font-size: 14px; font-weight: 600; }
.field strong, .field-error, .form-error { color: var(--status-error); }
.field-success { color: var(--status-success); }
.field small { font-size: 12px; }
.field textarea { resize: vertical; }
.image-input-row { display: flex; align-items: center; gap: 8px; }
.image-input-row .input { min-width: 0; }
.profile-form-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }
.profile-save { display: inline-flex; align-items: center; gap: 8px; }
.form-error { margin: 0; font-size: 14px; }
@media (max-width: 720px) { .profile-form-actions { flex-direction: column-reverse; } .profile-form-actions .btn { width: 100%; justify-content: center; } }
</style>