<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useNuxtApp, useRoute } from "nuxt/app"
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto"
import { DidCommRepository, type BucketMemberRole, type ExtrinsicUpdate } from "../../../../services/papi/didCommRepository"
import { ProfileClient } from "../../../../services/profile/profileClient"
import type { Profile } from "../../../../types/profile"
import { useOperationsStore } from "../../../../stores/operations"
import { useSessionStore } from "../../../../stores/session"
import WalletConnectPrompt from "../../../../components/common/WalletConnectPrompt.vue"

const route = useRoute()
const { $papiClient } = useNuxtApp()
const runtimeConfig = useRuntimeConfig()
const session = useSessionStore()
const asOptionalString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

// Convert any SS58 address to prefix 42
function convertToPrefix42(address: string): string {
  try {
    const input = address.trim()
    // Decode the address to get the raw public key bytes
    const bytes = decodeAddress(input)
    // Encode with prefix 42
    return encodeAddress(bytes, 42)
  } catch {
    // If decoding fails, return the original address
    return input
  }
}
const operations = useOperationsStore()
const profileClient = new ProfileClient()
const didCommRepository = new DidCommRepository(
  $papiClient as { rpc(method: string, params?: unknown[]): Promise<unknown>; getEndpoint?(): string },
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  {
    jwt: asOptionalString(runtimeConfig.public.pinataJwt),
    apiKey: asOptionalString(runtimeConfig.public.pinataApiKey),
    apiSecret: asOptionalString(runtimeConfig.public.pinataApiSecret),
    publicGateway: asOptionalString(runtimeConfig.public.pinataGateway)
  },
  undefined,
  undefined,
  undefined,
  String(runtimeConfig.public.subqueryIndexerUrl || "")
)

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
const memberAddress = ref("")
const submitting = ref(false)
const submitError = ref("")
const submittedTxHash = ref("")
const submittedMethod = ref("")

type ProfileStatus = "idle" | "loading" | "found" | "notFound" | "noKey" | "error"
const profile = ref<Profile | null>(null)
const profileStatus = ref<ProfileStatus>("idle")
const profileError = ref("")

let lookupTimer: ReturnType<typeof setTimeout> | null = null
let lastQueriedAddress = ""

const canSubmit = computed(() =>
  !submitting.value &&
  Boolean(memberAddress.value.trim()) &&
  Boolean(namespaceId.value.trim()) &&
  profileStatus.value === "found" &&
  Boolean(profile.value?.x25519Key)
)

const submitButtonLabel = computed(() => {
  if (submitting.value) {
    return "Submitting..."
  }

  if (submittedTxHash.value) {
    return "Submitted successfully"
  }

  return "Submit"
})

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
    const bucket = await didCommRepository.fetchBucket(bucketId.value)
    namespaceId.value = bucket?.namespaceId?.trim() ?? ""
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
  const normalizedAddress = convertToPrefix42(address)
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
  const normalizedAddress = convertToPrefix42(address)
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
  submittedTxHash.value = ""
  submittedMethod.value = ""
  profile.value = null
  profileError.value = ""
  profileStatus.value = "idle"
  scheduleLookup()
})

watch(namespaceId, () => {
  submittedTxHash.value = ""
  submittedMethod.value = ""
})

watch(role, () => {
  submittedTxHash.value = ""
  submittedMethod.value = ""
})

onMounted(async () => {
  namespaceId.value = extractRouteNamespaceId()
  await loadNamespaceFromBucket()
})

onBeforeUnmount(() => {
  if (lookupTimer) {
    clearTimeout(lookupTimer)
  }
})

function logExtrinsicUpdate(update: ExtrinsicUpdate): void {
  const details = [update.message]
  if (update.txHash) {
    details.push(`tx: ${update.txHash}`)
  }
  if (update.blockHash) {
    details.push(`block: ${update.blockHash}`)
  }

  operations.add("bucket_write", `bucket-member:${update.stage}`, update.stage === "error" ? "error" : "info", details.join(" · "))
}

async function submitAddMember(): Promise<void> {
  submitError.value = ""
  submittedTxHash.value = ""
  submittedMethod.value = ""

  if (!bucketId.value.trim()) {
    submitError.value = "Bucket id is required"
    return
  }

  if (!namespaceId.value.trim()) {
    submitError.value = "Namespace id is required"
    return
  }

  if (!memberAddress.value.trim()) {
    submitError.value = "Member address is required"
    return
  }

  if (!session.accountAddress) {
    submitError.value = "Connect wallet before submitting bucket member extrinsics"
    return
  }

  const x25519Key = profile.value?.x25519Key
  if (profileStatus.value !== "found" || !x25519Key) {
    submitError.value = "A profile with an X25519 key is required for this address"
    return
  }

  submitting.value = true

  try {
    const result = await didCommRepository.addBucketMemberWithRole(
      role.value,
      namespaceId.value,
      bucketId.value,
      memberAddress.value,
      x25519Key,
      session.accountAddress,
      logExtrinsicUpdate
    )

    submittedTxHash.value = result.txHash
    submittedMethod.value = result.method
    operations.add("bucket_write", bucketId.value, "success", `Member extrinsic submitted (${result.method}): ${result.txHash}`)
    memberAddress.value = ""
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : "Unable to submit bucket member extrinsic"
    operations.add("bucket_write", `bucket:${bucketId.value}`, "error", submitError.value)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="chat-custom-page">
    <div class="info-content-scroll stack">
    <section class="stack" aria-live="polite">
      <div class="row buckets-header" style="justify-content: space-between; align-items: center">
        <div class="row" style="gap: 12px; align-items: center">
          <div class="stack" style="gap: 4px">
            <h3 style="margin: 0">Add Member</h3>
          </div>
        </div>
      </div>

      <WalletConnectPrompt
        v-if="!session.accountAddress"
        title="Connect Wallet to Manage Members"
        description="You must connect your wallet to submit member management extrinsics."
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
          <button class="btn btn-primary" type="button" :disabled="!canSubmit" @click="submitAddMember">
            {{ submitButtonLabel }}
          </button>
        </div>
      </div>
    </section>
    </div>
  </div>
</template>
<style scoped>
.chat-custom-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  margin: -24px;
  background: #f7f8fa;
  overflow: hidden;
}

.info-content-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  overscroll-behavior: contain;
}

@media (max-width: 960px) {
  .chat-custom-page {
    height: calc(100vh - 56px);
    margin: -16px;
  }
  .info-content-scroll {
    padding: 16px;
  }
}
</style>
