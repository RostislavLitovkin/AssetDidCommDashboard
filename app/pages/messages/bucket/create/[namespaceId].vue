<script setup lang="ts">
import { DidCommRepository, type ExtrinsicUpdate } from "../../../../services/papi/didCommRepository"
import WalletConnectPrompt from "../../../../components/common/WalletConnectPrompt.vue"
import LoadingBar from "../../../../components/common/LoadingBar.vue"
import { ShieldAlert } from "lucide-vue-next"
import { computed, onMounted, ref } from "vue"
import { useNuxtApp, useRoute } from "nuxt/app"
import { useOperationsStore } from "../../../../stores/operations"
import { useSessionStore } from "../../../../stores/session"
import { useAddress } from "../../../../composables/useAddress"

const route = useRoute()
const { $papiClient } = useNuxtApp()
const runtimeConfig = useRuntimeConfig()
const session = useSessionStore()
const asOptionalString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
const operations = useOperationsStore()
const { addressesEqual } = useAddress()
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

const namespaceId = computed(() => {
  const rawId = route.params.namespaceId
  const value = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "")

  try {
    return decodeURIComponent(String(value))
  } catch {
    return String(value)
  }
})

const namespaceRoutePath = computed(() => `/messages/namespace/${encodeURIComponent(namespaceId.value)}`)
const isWalletConnected = computed(() => session.walletStatus === "connected" && Boolean(session.accountAddress))

const bucketName = ref("")
const category = ref("")
const submitting = ref(false)
const submitError = ref("")
const submittedTxHash = ref("")
const submittedMethod = ref("")

// Manager check
const managers = ref<string[]>([])
const managersLoading = ref(false)
const isManager = computed(() => {
  if (!session.accountAddress) return false
  return managers.value.some(m => addressesEqual(m, session.accountAddress!))
})

async function loadManagers() {
  managersLoading.value = true
  try {
    managers.value = await didCommRepository.fetchNamespaceManagers(namespaceId.value)
  } catch {
    managers.value = []
  } finally {
    managersLoading.value = false
  }
}

function logExtrinsicUpdate(update: ExtrinsicUpdate): void {
  const details = [update.message]
  if (update.txHash) {
    details.push(`tx: ${update.txHash}`)
  }
  if (update.blockHash) {
    details.push(`block: ${update.blockHash}`)
  }

  operations.add("bucket_write", `bucket:${update.stage}`, update.stage === "error" ? "info" : "info", details.join(" · "))
}

async function submitCreateBucket(): Promise<void> {
  submitError.value = ""
  submittedTxHash.value = ""
  submittedMethod.value = ""

  if (!namespaceId.value.trim()) {
    submitError.value = "Namespace id is required"
    return
  }

  if (!bucketName.value.trim()) {
    submitError.value = "Bucket name is required"
    return
  }

  if (!session.accountAddress) {
    submitError.value = "Connect wallet before submitting buckets.createBucket extrinsic"
    return
  }

  submitting.value = true

  try {
    const result = await didCommRepository.createBucket(
      namespaceId.value,
      bucketName.value,
      session.accountAddress,
      logExtrinsicUpdate,
      category.value
    )
    submittedTxHash.value = result.txHash
    submittedMethod.value = result.method
    operations.add("bucket_write", bucketName.value.trim(), "success", `Bucket extrinsic submitted: ${result.txHash}`)
    bucketName.value = ""
    category.value = ""
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : "Unable to submit bucket extrinsic"
    operations.add("bucket_write", "bucket", "error", submitError.value)
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await loadManagers()
})
</script>

<template>
  <div class="chat-custom-page">
    <div class="info-content-scroll stack">
      <div class="row buckets-header" style="justify-content: space-between; align-items: center">
        <div class="stack" style="gap: 4px">
          <h3 style="margin: 0">Add Bucket</h3>
        </div>
      </div>

      <WalletConnectPrompt v-if="!isWalletConnected" title="Connect Your Wallet"
        description="Connect your wallet to create a bucket in this namespace." />

      <template v-else>
        <!-- Manager check loading -->
        <LoadingBar v-if="managersLoading" label="Checking namespace permissions..." />

        <!-- Not a manager warning -->
        <div v-else-if="!isManager" class="not-manager-notice">
          <ShieldAlert :size="20" class="not-manager-icon" />
          <div class="not-manager-text">
            <strong>Not a namespace manager</strong>
            <span class="muted">Your connected wallet is not a manager of this namespace and cannot create buckets.</span>
          </div>
        </div>

        <!-- Create form -->
        <section class="card stack" aria-live="polite">
          <label class="stack" style="gap: 6px">
            <span>Namespace</span>
            <input class="input" type="text" :value="namespaceId" disabled />
          </label>

          <label class="stack" style="gap: 6px">
            <span>Bucket Name</span>
            <input v-model="bucketName" class="input" type="text" name="bucket-name" placeholder="e.g. primary-bucket"
              :disabled="submitting || (!managersLoading && !isManager)" />
          </label>

          <label class="stack" style="gap: 6px">
            <span>Category (Optional)</span>
            <input v-model="category" class="input" type="text" name="category" placeholder="e.g. communication"
              :disabled="submitting || (!managersLoading && !isManager)" />
          </label>

          <div class="row" style="justify-content: flex-end; gap: 8px">
            <button class="btn btn-primary" type="button" :disabled="submitting || managersLoading || !isManager" @click="submitCreateBucket">
              {{ submitting ? "Submitting..." : "Submit Extrinsic" }}
            </button>
          </div>

          <p v-if="submitError" style="margin: 0; color: var(--status-error)">{{ submitError }}</p>
          <p v-if="submittedTxHash" style="margin: 0; color: var(--status-success)">
            Submitted via {{ submittedMethod }} successfully.
          </p>
        </section>
      </template>
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

/* Yellow "not a manager" notice — matches ib-not-contributor style */
.not-manager-notice {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--status-warning) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--status-warning) 25%, transparent);
}

.not-manager-icon {
  flex-shrink: 0;
  color: var(--status-warning);
}

.not-manager-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  min-width: 0;
}

.not-manager-text strong {
  font-size: 14px;
  color: var(--text-primary);
}

@media (max-width: 840px) {
  .not-manager-notice {
    flex-direction: column;
    text-align: center;
    padding: 16px;
  }
}
</style>
