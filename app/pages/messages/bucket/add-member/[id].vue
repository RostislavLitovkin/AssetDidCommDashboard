<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute } from "nuxt/app"
import type { BucketMemberRole, OperationUpdate } from "../../../../services/buckets/types"
import { ProfileClient } from "../../../../services/profile/profileClient"
import { normalizeApiAddress } from "../../../../services/wallet/addressUtils"
import type { Profile } from "../../../../types/profile"
import { useOperationsStore } from "../../../../stores/operations"
import { useSessionStore } from "../../../../stores/session"
import WalletConnectPrompt from "../../../../components/common/WalletConnectPrompt.vue"
import PageHeader from "../../../../components/common/PageHeader.vue"
import SubmitButton from "../../../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../../../components/common/submitButtonView"
import { useSubmitState } from "../../../../composables/useSubmitState"

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const session = useSessionStore()

const operations = useOperationsStore()
const profileClient = new ProfileClient(String(runtimeConfig.public.profileApiUrl))
const bucketsRepository = useBucketsRepository()

const roleOptions: { value: BucketMemberRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "contributor", label: "Contributor" },
  { value: "viewer", label: "Viewer" }
]

const bucketId = computed(() => {
  const rawParam = route.params.id
  const rawQuery = route.query.bucketId
  const raw = Array.isArray(rawParam) ? (rawParam[0] ?? "") : (rawParam ?? rawQuery ?? "")

  try {
    return decodeURIComponent(String(raw)).trim()
  } catch {
    return String(raw).trim()
  }
})

const role = ref<BucketMemberRole>("admin")
const namespaceId = ref("")
// Standalone buckets have no namespace — members are added with a null
// namespace id, so an empty namespace field must not block the submit.
const isStandalone = ref(false)
const memberAddress = ref("")
const {
  phase: submitPhase,
  errorMessage: submitError,
  isBusy: submitting,
  applyUpdate: applySubmitUpdate,
  fail: failSubmit,
  reset: resetSubmit,
  run: runSubmit
} = useSubmitState()

type ProfileStatus = "idle" | "loading" | "found" | "notFound" | "noKey" | "error"
const profile = ref<Profile | null>(null)
const profileStatus = ref<ProfileStatus>("idle")
const profileError = ref("")

let lookupTimer: ReturnType<typeof setTimeout> | null = null
let lastQueriedAddress = ""

const submitLabels: SubmitButtonLabels = {
  idle: "Add member",
  signing: "Signing…",
  submitting: "Adding member…",
  success: "Member added",
  error: "Add failed — retry"
}

const canSubmit = computed(() =>
  Boolean(memberAddress.value.trim()) &&
  (Boolean(namespaceId.value.trim()) || isStandalone.value) &&
  profileStatus.value === "found" &&
  Boolean(profile.value?.x25519Key)
)

function extractRouteNamespaceId(): string {
  const raw = route.query.namespaceId
  const value = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "")

  try {
    return decodeURIComponent(String(value)).trim()
  } catch {
    return String(value).trim()
  }
}

async function loadNamespaceFromBucket(): Promise<void> {
  if (namespaceId.value) {
    return
  }

  try {
    const bucket = await bucketsRepository.fetchBucket(bucketId.value)
    if (!bucket) {
      return
    }
    namespaceId.value = bucket.namespaceId?.trim() ?? ""
    isStandalone.value = bucket.namespaceId == null
  } catch {
  }
}

async function lookupProfile(): Promise<void> {
  const address = memberAddress.value.trim()
  if (!address) {
    profileStatus.value = "idle"
    profile.value = null
    profileError.value = ""
    return
  }

  // Convert any SS58 address to prefix 42 for the profile API
  const normalizedAddress = normalizeApiAddress(address)
  lastQueriedAddress = normalizedAddress
  profileStatus.value = "loading"
  profile.value = null
  profileError.value = ""

  try {
    const result = await profileClient.getProfile(normalizedAddress)

    // Ignore results for a stale query if the address changed while loading.
    if (memberAddress.value.trim() !== address) {
      return
    }

    if (!result) {
      profileStatus.value = "notFound"
      return
    }

    profile.value = result
    profileStatus.value = result.x25519Key ? "found" : "noKey"
  } catch (error) {
    if (memberAddress.value.trim() !== address) {
      return
    }
    profileStatus.value = "error"
    profileError.value = error instanceof Error ? error.message : "Unable to load profile"
  }
}

function scheduleLookup(): void {
  if (lookupTimer) {
    clearTimeout(lookupTimer)
  }
  const address = memberAddress.value.trim()
  if (!address) {
    return
  }
  lookupTimer = setTimeout(() => {
    void lookupProfile()
  }, 400)
}

function lookupProfileNow(): void {
  if (lookupTimer) {
    clearTimeout(lookupTimer)
    lookupTimer = null
  }
  const address = memberAddress.value.trim()
  if (!address) {
    return
  }
  // Convert to prefix 42 for comparison with lastQueriedAddress
  const normalizedAddress = normalizeApiAddress(address)
  // Avoid a redundant request if this address is already resolved.
  if (normalizedAddress === lastQueriedAddress && profileStatus.value !== "idle" && profileStatus.value !== "loading") {
    return
  }
  void lookupProfile()
}

watch(
  () => route.query.namespaceId,
  () => {
    namespaceId.value = extractRouteNamespaceId()
  }
)

watch(memberAddress, () => {
  resetSubmit()
  profile.value = null
  profileError.value = ""
  profileStatus.value = "idle"
  scheduleLookup()
})

watch(namespaceId, resetSubmit)
watch(role, resetSubmit)

onMounted(async () => {
  namespaceId.value = extractRouteNamespaceId()
  await loadNamespaceFromBucket()
})

onBeforeUnmount(() => {
  if (lookupTimer) {
    clearTimeout(lookupTimer)
  }
})

// Drives the button only. The page logs one terminal entry per submit below —
// see the "Loggers drive phases; pages log outcomes" global constraint.
function logOperationUpdate(update: OperationUpdate): void {
  applySubmitUpdate(update)
}

async function submitAddMember(): Promise<void> {
  const bucket = bucketId.value.trim()
  if (!bucket) {
    failSubmit("Bucket id is required")
    return
  }

  const namespace = namespaceId.value.trim()
  if (!namespace && !isStandalone.value) {
    failSubmit("Namespace id is required")
    return
  }

  const member = memberAddress.value.trim()
  if (!member) {
    failSubmit("Member address is required")
    return
  }

  const address = session.accountAddress
  if (!address) {
    failSubmit("Connect wallet before adding bucket members")
    return
  }

  const x25519Key = profile.value?.x25519Key
  if (profileStatus.value !== "found" || !x25519Key) {
    failSubmit("A profile with an X25519 key is required for this address")
    return
  }

  await runSubmit(async () => {
    const result = await bucketsRepository.addBucketMemberWithRole(
      role.value,
      namespace || null,
      bucket,
      normalizeApiAddress(member),
      x25519Key,
      address,
      logOperationUpdate
    )
    operations.add("bucket_write", "Add member", "success", `Member added: ${result.id}`)
  })

  if (submitPhase.value === "error") {
    operations.add("bucket_write", "Add member", "error", submitError.value)
  }
}
</script>

<template>
  <div class="chat-custom-page">
    <div class="info-content-scroll stack">
    <section class="stack" aria-live="polite">
      <PageHeader title="Add Member" />

      <WalletConnectPrompt
        v-if="!session.accountAddress"
        title="Connect Wallet to Manage Members"
        description="You must connect your wallet to manage bucket members."
      />

      <div v-else class="card stack" style="gap: 16px;">
        <label class="stack" style="gap: 8px">
          <span style="font-weight: 600; font-size: 14px;">Member Address</span>
          <input
            v-model="memberAddress"
            class="input"
            type="text"
            name="member-address"
            placeholder="Enter SS58 address"
            :disabled="submitting"
            @blur="lookupProfileNow"
          />
          <span v-if="profileStatus === 'loading'" class="muted" style="font-size: 12px;">Looking up profile…</span>
          <span v-else-if="profileStatus === 'found'" style="font-size: 12px; color: var(--status-success, #1a7f37);">
            ✓ Profile found<template v-if="profile?.nickname"> — {{ profile.nickname }}</template>
          </span>
          <span v-else-if="profileStatus === 'notFound'" style="font-size: 12px; color: var(--status-error);">
            No profile exists for this address, so it cannot be added.
          </span>
          <span v-else-if="profileStatus === 'noKey'" style="font-size: 12px; color: var(--status-error);">
            This profile has no X25519 encryption key and cannot be added.
          </span>
          <span v-else-if="profileStatus === 'error'" style="font-size: 12px; color: var(--status-error);">
            {{ profileError || "Unable to load profile." }}
          </span>
        </label>

        <div class="stack" style="gap: 8px">
          <span style="font-weight: 600; font-size: 14px;">Role</span>
          <div style="display: flex; background: #f6f7f9; border-radius: 8px; border: 1px solid var(--border-default); overflow: hidden; padding: 4px; gap: 4px;">
            <button
              v-for="option in roleOptions"
              :key="option.value"
              type="button"
              style="flex: 1; padding: 10px 16px; border: none; background: transparent; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; border-radius: 6px;"
              :style="role === option.value ? 'background: var(--color-white); box-shadow: 0 1px 3px rgba(0,0,0,0.1); color: var(--color-primary);' : 'color: var(--text-secondary);'"
              :disabled="submitting"
              @click="role = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <p v-if="submitError" style="margin: 0; color: var(--status-error); font-size: 13px;">{{ submitError }}</p>

        <div class="row" style="justify-content: flex-end; gap: 12px; margin-top: 8px;">
          <SubmitButton
            :phase="submitPhase"
            :labels="submitLabels"
            :disabled="!canSubmit"
            @click="submitAddMember"
          />
        </div>
      </div>
    </section>
    </div>
  </div>
</template>
