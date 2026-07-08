<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { useNuxtApp, useRoute } from "nuxt/app"
import { DidCommRepository, type ExtrinsicUpdate } from "../../../../services/papi/didCommRepository"
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
const operations = useOperationsStore()
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

const namespaceId = ref("")
const memberAddress = ref("")
const submitting = ref(false)
const submitError = ref("")
const submittedTxHash = ref("")
const submittedMethod = ref("")

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

watch(
  () => route.query.namespaceId,
  () => {
    namespaceId.value = extractRouteNamespaceId()
  }
)

watch(memberAddress, () => {
  submittedTxHash.value = ""
  submittedMethod.value = ""
})

watch(namespaceId, () => {
  submittedTxHash.value = ""
  submittedMethod.value = ""
})

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

  operations.add("bucket_write", `bucket-viewer:${update.stage}`, update.stage === "error" ? "error" : "info", details.join(" · "))
}

async function submitAddViewer(): Promise<void> {
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
    submitError.value = "Viewer address is required"
    return
  }

  if (!session.accountAddress) {
    submitError.value = "Connect wallet before submitting bucket member extrinsics"
    return
  }

  submitting.value = true

  try {
    const result = await didCommRepository.addBucketViewer(
      namespaceId.value,
      bucketId.value,
      memberAddress.value,
      session.accountAddress,
      logExtrinsicUpdate
    )

    submittedTxHash.value = result.txHash
    submittedMethod.value = result.method
    operations.add("bucket_write", bucketId.value, "success", `Viewer extrinsic submitted: ${result.txHash}`)
    memberAddress.value = ""
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : "Unable to submit bucket viewer extrinsic"
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
            <h3 style="margin: 0">Add Viewer</h3>
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
          <span style="font-weight: 600; font-size: 14px;">Viewer X25519 Key</span>
          <input
            v-model="memberAddress"
            class="input"
            type="text"
            name="member-address"
            placeholder="Enter X25519 public key"
            :disabled="submitting"
          />
        </label>

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

        <div class="row" style="justify-content: flex-end; gap: 12px; margin-top: 8px;">
          <button class="btn btn-primary" type="button" :disabled="submitting || !memberAddress" @click="submitAddViewer">
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
