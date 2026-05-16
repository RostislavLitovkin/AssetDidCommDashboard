<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { useNuxtApp, useRoute } from "nuxt/app"
import { DidCommRepository, type ExtrinsicUpdate } from "../../../../services/papi/didCommRepository"
import { useOperationsStore } from "../../../../stores/operations"
import { useSessionStore } from "../../../../stores/session"
import WalletConnectPrompt from "../../../../components/common/WalletConnectPrompt.vue"

const route = useRoute()
const { $papiClient } = useNuxtApp()
const session = useSessionStore()
const operations = useOperationsStore()
const didCommRepository = new DidCommRepository(
  $papiClient as { rpc(method: string, params?: unknown[]): Promise<unknown>; getEndpoint?(): string }
)

type MemberRole = "admin" | "contributor"

function toMemberRole(value: unknown): MemberRole {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate === "contributor" ? "contributor" : "admin"
}

const bucketId = computed(() => {
  const rawId = route.params.id
  const value = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "")

  try {
    return decodeURIComponent(String(value))
  } catch {
    return String(value)
  }
})

const bucketRoutePath = computed(() => `/indexed-bucket/${encodeURIComponent(bucketId.value)}`)

const role = ref<MemberRole>(toMemberRole(route.query.role))
const namespaceId = ref("")
const memberAddress = ref("")
const submitting = ref(false)
const submitError = ref("")
const submittedTxHash = ref("")
const submittedMethod = ref("")

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

watch(
  () => route.query.role,
  (value) => {
    role.value = toMemberRole(value)
  }
)

watch(
  () => route.query.namespaceId,
  () => {
    namespaceId.value = extractRouteNamespaceId()
  }
)

onMounted(async () => {
  namespaceId.value = extractRouteNamespaceId()
  await loadNamespaceFromBucket()
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

  submitting.value = true

  try {
    const result =
      role.value === "admin"
        ? await didCommRepository.addBucketAdmin(
            namespaceId.value,
            bucketId.value,
            memberAddress.value,
            session.accountAddress,
            logExtrinsicUpdate
          )
        : await didCommRepository.addBucketContributor(
            namespaceId.value,
            bucketId.value,
            memberAddress.value,
            session.accountAddress,
            logExtrinsicUpdate
          )

    submittedTxHash.value = result.txHash
    submittedMethod.value = result.method
    operations.add("bucket_write", bucketId.value, "success", `Member extrinsic submitted: ${result.txHash}`)
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
            <h3 style="margin: 0">Add {{ role === 'admin' ? 'Admin' : 'Contributor' }}</h3>
          </div>
        </div>
      </div>

      <WalletConnectPrompt
        v-if="!session.accountAddress"
        title="Connect Wallet to Manage Members"
        description="You must connect your wallet to submit member management extrinsics."
      />
      
      <div v-else class="card stack" style="gap: 16px;">
        <h4 style="margin: 0; font-size: 16px;">Assign Permissions</h4>

        <label class="stack" style="gap: 8px">
          <span style="font-weight: 600; font-size: 14px;">Member Address</span>
          <input
            v-model="memberAddress"
            class="input"
            type="text"
            name="member-address"
            placeholder="Enter SS58 address"
            :disabled="submitting"
          />
        </label>

        <div class="stack" style="gap: 8px">
          <span style="font-weight: 600; font-size: 14px;">Role</span>
          <div style="display: flex; background: #f6f7f9; border-radius: 8px; border: 1px solid var(--border-default); overflow: hidden; padding: 4px; gap: 4px;">
            <button 
              type="button" 
              style="flex: 1; padding: 10px 16px; border: none; background: transparent; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; border-radius: 6px;"
              :style="role === 'admin' ? 'background: var(--color-white); box-shadow: 0 1px 3px rgba(0,0,0,0.1); color: var(--color-primary);' : 'color: var(--text-secondary);'"
              @click="role = 'admin'"
              :disabled="submitting"
            >
              Admin
            </button>
            <button 
              type="button" 
              style="flex: 1; padding: 10px 16px; border: none; background: transparent; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; border-radius: 6px;"
              :style="role === 'contributor' ? 'background: var(--color-white); box-shadow: 0 1px 3px rgba(0,0,0,0.1); color: var(--color-primary);' : 'color: var(--text-secondary);'"
              @click="role = 'contributor'"
              :disabled="submitting"
            >
              Contributor
            </button>
          </div>
        </div>
        
        <label class="stack" style="gap: 8px">
          <span style="font-weight: 600; font-size: 14px;">Namespace ID</span>
          <input
            v-model="namespaceId"
            class="input"
            type="text"
            name="namespace-id"
            placeholder="e.g. 0"
            :disabled="submitting"
          />
        </label>

        <label class="stack" style="gap: 8px">
          <span style="font-weight: 600; font-size: 14px;">Bucket ID</span>
          <input class="input" type="text" :value="bucketId" disabled />
        </label>

        <p v-if="submitError" style="margin: 0; color: var(--status-error); font-size: 13px;">{{ submitError }}</p>
        <p v-if="submittedTxHash" style="margin: 0; color: var(--status-success); font-size: 13px;">
          Submitted via {{ submittedMethod }} with hash {{ submittedTxHash }}
        </p>

        <div class="row" style="justify-content: flex-end; gap: 12px; margin-top: 8px;">
          <NuxtLink class="btn" :to="`${bucketRoutePath}/info`">Cancel</NuxtLink>
          <button class="btn btn-primary" type="button" :disabled="submitting || !memberAddress" @click="submitAddMember">
            {{ submitting ? "Submitting..." : "Submit Transaction" }}
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
