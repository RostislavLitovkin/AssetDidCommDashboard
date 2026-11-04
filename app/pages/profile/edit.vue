<script setup lang="ts">
import { ArrowLeft, Camera, Lock, UserRound, WandSparkles } from "lucide-vue-next"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRouter } from "vue-router"
import { useProfileStatus } from "../../composables/useProfileStatus"
import { useWallet } from "../../composables/useWallet"
import { ProfileClient } from "../../services/profile/profileClient"
import { resizeProfileImage } from "../../services/profile/imageResize"
import { validateX25519PublicKey } from "../../services/profile/x25519KeyValidation"
import { useSettingsStore } from "../../stores/settings"
import SubmitButton from "../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../components/common/submitButtonView"
import { useSubmitState } from "../../composables/useSubmitState"
import defaultProfilePicture from "../../assets/Images/xcavateprofilepicture.png"

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
const profilePicturePreview = ref("")
const imageInputRef = ref<HTMLInputElement | null>(null)
const x25519Key = ref("")
const x25519Touched = ref(false)
const submitAttempted = ref(false)
const nicknameError = ref("")
const nicknameChecking = ref(false)
const nicknameAvailable = ref(false)
const loadError = ref("")
const hasConnectedWallet = computed(() => Boolean(wallet.accountAddress.value))
const displayedProfilePicture = computed(
  () => profilePicturePreview.value || profilePicture.value || defaultProfilePicture
)
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
  loadError.value = ""
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
  } catch (caughtError) {
    // A load failure is not a submit failure — it must not paint the submit
    // button red before the user has done anything. Render it as plain text.
    loadError.value = caughtError instanceof Error ? caughtError.message : "Unable to load profile"
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
  // A field edit during the pause resets the phase to idle; re-check so a
  // keystroke during the wait isn't discarded by a navigation that no longer
  // reflects a successful save.
  if (submitPhase.value !== "success") return
  await router.push("/profile")
}

function openImagePicker(): void {
  imageInputRef.value?.click()
}

function selectImage(event: Event): void {
  const input = event.target as HTMLInputElement
  const nextImage = input.files?.[0] || null
  if (profilePicturePreview.value) {
    URL.revokeObjectURL(profilePicturePreview.value)
  }
  selectedImage.value = nextImage
  profilePicturePreview.value = nextImage ? URL.createObjectURL(nextImage) : ""
}

watch(() => wallet.accountAddress.value, loadProfile)
onMounted(() => {
  settings.initialize()
  loadProfile()
})
onBeforeUnmount(() => {
  if (profilePicturePreview.value) {
    URL.revokeObjectURL(profilePicturePreview.value)
  }
})
</script>

<template>
  <main class="profile-edit-page">
    <header class="profile-edit-hero">
      <img class="profile-edit-cover" src="@/assets/Images/xcavatelandscape.png" alt="" />
      <nav class="profile-edit-navigation" aria-label="Profile navigation">
        <NuxtLink class="profile-back-action" to="/profile" aria-label="Back to profile">
          <ArrowLeft :size="24" aria-hidden="true" />
        </NuxtLink>
        <h1>{{ profileExists ? "Edit profile" : "Create profile" }}</h1>
      </nav>

      <div v-if="hasConnectedWallet && !loading" class="profile-avatar-container">
        <img class="profile-edit-avatar" :src="displayedProfilePicture" alt="Profile picture" />
        <button class="profile-camera-action" type="button" aria-label="Change profile picture" @click="openImagePicker">
          <Camera :size="15" aria-hidden="true" />
        </button>
        <input
          id="profile-picture"
          ref="imageInputRef"
          class="sr-only"
          type="file"
          name="profilePicture"
          accept="image/*"
          aria-label="Profile picture file"
          tabindex="-1"
          @change="selectImage($event); resetSubmit()"
        />
      </div>
    </header>

    <section v-if="!hasConnectedWallet" class="card profile-edit-empty stack">
      <UserRound :size="28" aria-hidden="true" />
      <h2>Connect a wallet to create a profile</h2>
      <NuxtLink class="btn profile-empty-action" to="/profile">Back to profile</NuxtLink>
    </section>

    <section v-else-if="loading" class="card profile-edit-empty" aria-busy="true">
      <span class="muted">Loading profile...</span>
    </section>

    <form v-else class="profile-form" @submit.prevent="saveProfile">
      <div class="profile-fields">
        <div class="field">
          <label class="field-label" for="nickname">Nickname</label>
          <input
            id="nickname"
            v-model="nickname"
            class="input"
            name="nickname"
            maxlength="64"
            autocomplete="nickname"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="Enter your nickname (optional)"
            :aria-describedby="nicknameChecking || nicknameError || nicknameAvailable ? 'nickname-status' : undefined"
            @blur="validateNickname"
            @input="resetSubmit"
          />
          <small v-if="nicknameChecking" id="nickname-status" class="muted">Checking availability...</small>
          <small v-else-if="nicknameError" id="nickname-status" class="field-error" aria-live="polite">{{ nicknameError }}</small>
          <small v-else-if="nicknameAvailable" id="nickname-status" class="field-success" aria-live="polite">This nickname is available</small>
        </div>

        <div class="field">
          <label class="field-label" for="bio">Bio</label>
          <textarea
            id="bio"
            v-model="bio"
            class="input"
            name="bio"
            rows="4"
            maxlength="1000"
            placeholder="Enter your bio (optional)"
            @input="resetSubmit"
          />
        </div>

        <div class="profile-dashboard-fields">
          <div class="field">
            <label class="field-label" for="wallet-address">
              Wallet address
              <span class="field-locked"><Lock :size="12" aria-hidden="true" />Locked</span>
            </label>
            <input
              id="wallet-address"
              class="input"
              name="walletAddress"
              :value="wallet.accountAddress.value"
              readonly
              aria-readonly="true"
              tabindex="-1"
            />
          </div>

          <div class="field">
            <label class="field-label" for="x25519-key">X25519 encryption public key <span class="field-optional">required</span></label>
            <input
              id="x25519-key"
              v-model="x25519Key"
              class="input"
              name="x25519Key"
              required
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              :aria-invalid="showX25519Error"
              :aria-describedby="showX25519Error ? 'x25519-error' : undefined"
              @blur="x25519Touched = true"
              @input="resetSubmit"
            />
            <small v-if="showX25519Error" id="x25519-error" class="field-error" aria-live="polite">{{ x25519Error }}</small>
            <button v-if="canAdoptActiveX25519Key" class="btn field-action" type="button" @click="adoptActiveX25519Key">
              <WandSparkles :size="14" aria-hidden="true" />
              Use my active key
            </button>
          </div>
        </div>

        <p v-if="submitError || loadError" class="form-error" aria-live="polite">{{ submitError || loadError }}</p>
      </div>

      <div class="profile-form-actions">
        <NuxtLink class="btn profile-cancel-action" to="/profile">Cancel</NuxtLink>
        <SubmitButton
          class="profile-save"
          type="submit"
          :phase="submitPhase"
          :labels="submitLabels"
          :disabled="nicknameChecking || !isFormValid"
        />
      </div>
    </form>
  </main>
</template>

<style>
.app-shell-content:has(.profile-edit-page) .container {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 0;
}
</style>

<style scoped>
.profile-edit-page {
  min-height: 100%;
  margin: -24px;
  background: var(--surface-card);
}
.profile-edit-hero {
  position: relative;
  height: 200px;
}
.profile-edit-cover {
  display: block;
  width: 100%;
  height: 160px;
  object-fit: cover;
  background: #aaaaaa;
}
.profile-edit-navigation {
  position: absolute;
  inset: 0 0 auto;
  height: 45px;
  display: flex;
  align-items: center;
  background: rgba(59, 79, 116, 0.65);
  color: var(--color-white);
}
.profile-edit-navigation h1 {
  position: absolute;
  left: 50%;
  margin: 0;
  transform: translateX(-50%);
  font-size: 16px;
  line-height: 1.2;
  white-space: nowrap;
}
.profile-back-action {
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 45px;
  height: 45px;
  color: var(--color-white);
}
.profile-back-action:hover,
.profile-back-action:focus-visible {
  color: var(--color-white);
  background: rgba(255, 255, 255, 0.12);
}
.profile-avatar-container {
  position: absolute;
  bottom: 0;
  left: max(10px, calc((100% - 680px) / 2));
  width: 80px;
  height: 80px;
}
.profile-edit-avatar {
  display: block;
  width: 80px;
  height: 80px;
  border: 5px solid var(--surface-card);
  border-radius: 50%;
  object-fit: cover;
  background: var(--color-gray-300);
}
.profile-camera-action {
  position: absolute;
  right: 5px;
  bottom: 0;
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #cccccc;
  color: var(--color-black);
  cursor: pointer;
}
.profile-edit-empty {
  align-items: flex-start;
  width: min(680px, calc(100% - 40px));
  margin: 24px auto;
  padding: 28px;
}
.profile-edit-empty h2 {
  margin: 0;
  font-size: 18px;
}
.profile-empty-action {
  display: inline-flex;
  align-items: center;
  min-height: 48px;
}
.profile-form {
  width: min(720px, 100%);
  margin: 0 auto;
  padding: 20px 20px 24px;
}
.profile-fields,
.profile-dashboard-fields {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.profile-dashboard-fields {
  margin-top: 5px;
  padding-top: 20px;
  border-top: 1px solid var(--border-default);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 14px;
}
.field .input {
  min-height: 40px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--surface-card);
  font-size: 16px;
  font-weight: 700;
}
.field .input::placeholder {
  color: var(--color-gray-400);
  font-weight: 400;
}
.field textarea {
  min-height: 90px;
  resize: vertical;
  line-height: 1.4;
}
.field input[readonly] {
  background: var(--color-gray-50);
  color: var(--text-secondary);
  cursor: default;
}
.field-locked {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-gray-100);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}
.field-optional {
  color: var(--text-secondary);
  font-size: 12px;
}
.field small {
  margin: 0 10px;
  font-size: 12px;
}
.field-error,
.form-error {
  color: var(--status-error);
}
.field-success {
  color: var(--status-success);
}
.field-action {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 48px;
  padding: 10px 16px;
  border-radius: 24px;
  font-size: 12px;
}
.form-error {
  margin: 0;
  font-size: 14px;
}
.profile-form-actions {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 20px -20px -24px;
  padding: 10px 20px;
  background: var(--surface-card);
  box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.12);
}
.profile-cancel-action,
.profile-form-actions :deep(.profile-save) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 48px;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 700;
}
.profile-cancel-action {
  border: 2px solid #3b4f74;
  background: var(--color-white);
  color: #3b4f74;
}
.profile-cancel-action:hover,
.profile-cancel-action:focus-visible {
  border-color: #3b4f74;
  color: #3b4f74;
  box-shadow: 0 0 0 2px rgba(59, 79, 116, 0.18);
}
.profile-form-actions :deep(.profile-save.submit-button-primary) {
  border-color: #3b4f74;
  background: #3b4f74;
  color: var(--color-white);
}
.profile-form-actions :deep(.profile-save.submit-button-primary:hover:not(:disabled)),
.profile-form-actions :deep(.profile-save.submit-button-primary:focus-visible:not(:disabled)) {
  border-color: #3b4f74;
  color: var(--color-white);
  box-shadow: 0 0 0 2px rgba(59, 79, 116, 0.18);
}
@media (max-width: 960px) {
  .profile-edit-page {
    margin: -16px;
  }
}
@media (pointer: coarse) {
  .field .input {
    min-height: 48px;
  }
  .profile-camera-action::before {
    position: absolute;
    inset: -10px;
    content: "";
  }
}
</style>
