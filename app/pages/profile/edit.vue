<script setup lang="ts">
import { ArrowLeft, ImageUp, Lock, Save, UserRound, WandSparkles } from "lucide-vue-next"
import { computed, onMounted, ref, watch } from "vue"
import { useRouter } from "vue-router"
import { useProfileStatus } from "../../composables/useProfileStatus"
import { useWallet } from "../../composables/useWallet"
import { ProfileClient } from "../../services/profile/profileClient"
import { resizeProfileImage } from "../../services/profile/imageResize"
import { validateX25519PublicKey } from "../../services/profile/x25519KeyValidation"
import { useSettingsStore } from "../../stores/settings"
import PageHeader from "../../components/common/PageHeader.vue"
import SubmitButton from "../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../components/common/submitButtonView"
import { useSubmitState } from "../../composables/useSubmitState"

const wallet = useWallet()
const profileStatus = useProfileStatus()
const settings = useSettingsStore()
const router = useRouter()
const runtimeConfig = useRuntimeConfig()
const profileClient = new ProfileClient(String(runtimeConfig.public.profileApiUrl))
const loading = ref(false)
const {
  phase: submitPhase,
  errorMessage: submitError,
  markSigning,
  markSubmitting,
  fail: failSubmit,
  reset: resetSubmit,
  run: runSubmit
} = useSubmitState()
const profileExists = ref(false)
const originalNickname = ref("")
const nickname = ref("")
const bio = ref("")
const profilePicture = ref("")
const selectedImage = ref<File | null>(null)
const x25519Key = ref("")
const x25519Touched = ref(false)
const submitAttempted = ref(false)
const nicknameError = ref("")
const nicknameChecking = ref(false)
const nicknameAvailable = ref(false)
const hasConnectedWallet = computed(() => Boolean(wallet.accountAddress.value))
const x25519Error = computed(() => validateX25519PublicKey(x25519Key.value))
// The "required" complaint waits for a blur or a save attempt, but a key that is
// present and wrong is worth flagging the moment it is typed.
const showX25519Error = computed(
  () => Boolean(x25519Error.value) && (x25519Touched.value || submitAttempted.value || x25519Key.value.trim().length > 0)
)
const activeX25519Key = computed(() => settings.x25519SecretJwk?.x || "")
const canAdoptActiveX25519Key = computed(
  () => Boolean(activeX25519Key.value) && activeX25519Key.value !== x25519Key.value.trim()
)
// The nickname is optional; the X25519 key is not.
const isFormValid = computed(() => !x25519Error.value && !nicknameError.value)

const submitLabels = computed<SubmitButtonLabels>(() => ({
  idle: profileExists.value ? "Save changes" : "Create profile",
  signing: "Signing…",
  submitting: profileExists.value ? "Saving changes…" : "Creating profile…",
  success: profileExists.value ? "Changes saved" : "Profile created",
  error: profileExists.value ? "Save failed — retry" : "Create failed — retry"
}))

/** Marks signing on entry and submitting on exit, so a save that also uploads an
 *  image (two signatures) reports both rounds honestly. */
const signWithProgress: typeof wallet.signProfileRequest = async (method, path, body) => {
  markSigning()
  const headers = await wallet.signProfileRequest(method, path, body)
  markSubmitting()
  return headers
}

async function loadProfile(): Promise<void> {
  const address = wallet.accountAddress.value
  resetSubmit()
  x25519Touched.value = false
  submitAttempted.value = false
  if (!address) return

  loading.value = true
  try {
    const profile = await profileClient.getProfile(address)
    profileExists.value = Boolean(profile)
    originalNickname.value = profile?.nickname || ""
    nickname.value = profile?.nickname || ""
    bio.value = profile?.bio || ""
    profilePicture.value = profile?.profilePicture || ""
    x25519Key.value = profile?.x25519Key || activeX25519Key.value
  } catch (loadError) {
    failSubmit(loadError instanceof Error ? loadError.message : "Unable to load profile")
  } finally {
    loading.value = false
  }
}

function adoptActiveX25519Key(): void {
  x25519Key.value = activeX25519Key.value
  x25519Touched.value = true
  resetSubmit()
}

async function validateNickname(): Promise<void> {
  const requestedNickname = nickname.value.trim()
  nicknameError.value = ""
  nicknameAvailable.value = false
  if (!requestedNickname || requestedNickname === originalNickname.value) return

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
  resetSubmit()
  submitAttempted.value = true
  await validateNickname()

  // The profile is always written for the currently connected wallet — the
  // address field is display-only and never feeds this call.
  const address = wallet.accountAddress.value
  if (!address) {
    failSubmit("Connect a wallet before saving your profile.")
    return
  }
  if (!isFormValid.value) return

  await runSubmit(async () => {
    const saved = await profileClient.saveProfile(address, {
      nickname: nickname.value,
      bio: bio.value,
      profilePicture: profilePicture.value,
      x25519Key: x25519Key.value
    }, signWithProgress)
    let savedProfile = saved
    if (selectedImage.value) {
      // The profile must exist before the image endpoint accepts an upload, so
      // this runs after saveProfile. Resize to a small square JPEG to avoid 413s.
      const resized = await resizeProfileImage(selectedImage.value, address)
      profilePicture.value = await profileClient.uploadProfileImage(
        address,
        resized,
        signWithProgress
      )
      savedProfile = { ...saved, profilePicture: profilePicture.value }
    }
    // Keeps the account-setup banners in step without a second round trip.
    profileStatus.setProfile(savedProfile)
  })

  if (submitPhase.value !== "success") return
  // Let the confirmation land before leaving the page.
  await new Promise((resolve) => setTimeout(resolve, 900))
  await router.push("/profile")
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
      <div class="stack field">
        <span class="field-label">
          Wallet address
          <span class="field-locked"><Lock :size="12" aria-hidden="true" />Locked</span>
        </span>
        <input
          class="input"
          :value="wallet.accountAddress.value"
          readonly
          aria-readonly="true"
          aria-label="Wallet address"
          tabindex="-1"
        />
        <small class="muted">
          Always the wallet you have connected. Connect a different wallet to edit its profile instead.
        </small>
      </div>
      <label class="stack field">
        <span class="field-label">Nickname <span class="field-optional">optional</span></span>
        <input
          v-model="nickname"
          class="input"
          maxlength="64"
          autocomplete="nickname"
          @blur="validateNickname"
          @input="resetSubmit"
        />
        <small v-if="nicknameChecking" class="muted">Checking nickname...</small>
        <small v-else-if="nicknameError" class="field-error">{{ nicknameError }}</small>
        <small v-else-if="nicknameAvailable" class="field-success">This nickname is available.</small>
        <small v-else class="muted">Shown to other people in place of your wallet address.</small>
      </label>
      <label class="stack field">
        <span class="field-label">Bio</span>
        <textarea v-model="bio" class="input" rows="5" maxlength="1000" @input="resetSubmit" />
      </label>
      <label class="stack field">
        <span class="field-label">Profile picture</span>
        <span class="image-input-row">
          <ImageUp :size="18" aria-hidden="true" />
          <input class="input" type="file" accept="image/*" @change="selectImage($event); resetSubmit()" />
        </span>
        <small v-if="selectedImage" class="muted">{{ selectedImage.name }}</small>
        <small v-else-if="profilePicture" class="muted">Keep the current image unless you select a replacement.</small>
      </label>
      <div class="stack field">
        <label class="field-label" for="x25519-key">X25519 public key <strong>*</strong></label>
        <textarea
          id="x25519-key"
          v-model="x25519Key"
          class="input"
          rows="3"
          required
          aria-required="true"
          :aria-invalid="showX25519Error"
          @blur="x25519Touched = true"
          @input="resetSubmit"
        />
        <small v-if="showX25519Error" class="field-error" aria-live="polite">{{ x25519Error }}</small>
        <small v-else class="muted">Required. The base64 public key other people encrypt their messages to.</small>
        <button v-if="canAdoptActiveX25519Key" class="btn field-action" type="button" @click="adoptActiveX25519Key">
          <WandSparkles :size="14" aria-hidden="true" />
          Use my active key
        </button>
      </div>
      <p v-if="submitError" class="form-error" aria-live="polite">{{ submitError }}</p>
      <div class="profile-form-actions">
        <NuxtLink class="btn" to="/profile">Cancel</NuxtLink>
        <SubmitButton
          class="profile-save"
          type="submit"
          :phase="submitPhase"
          :labels="submitLabels"
          :disabled="nicknameChecking || !isFormValid"
        >
          <template #icon><Save :size="16" /></template>
        </SubmitButton>
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
.field-label { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
.field-locked { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; background: var(--color-gray-100); color: var(--text-secondary); font-size: 11px; font-weight: 600; }
.field-optional { color: var(--text-secondary); font-size: 12px; font-weight: 500; }
.field strong, .field-error, .form-error { color: var(--status-error); }
.field-success { color: var(--status-success); }
.field small { font-size: 12px; }
.field textarea { resize: vertical; }
.field-action { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 12px; }
.field input[readonly] { background: var(--color-gray-50); color: var(--text-secondary); cursor: default; }
.image-input-row { display: flex; align-items: center; gap: 8px; }
.image-input-row .input { min-width: 0; }
.profile-form-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }
.profile-save { display: inline-flex; align-items: center; gap: 8px; }
.form-error { margin: 0; font-size: 14px; }
@media (max-width: 720px) { .profile-form-actions { flex-direction: column-reverse; } .profile-form-actions .btn { width: 100%; justify-content: center; } }
</style>
