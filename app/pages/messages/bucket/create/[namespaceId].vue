<script setup lang="ts">
import { DidCommRepository, type ExtrinsicUpdate } from "../../../../services/papi/didCommRepository"
import WalletConnectPrompt from "../../../../components/common/WalletConnectPrompt.vue"
import { computed, ref } from "vue"
import { useNuxtApp, useRoute } from "nuxt/app"
import { useOperationsStore } from "../../../../stores/operations"
import { useSessionStore } from "../../../../stores/session"

const route = useRoute()
const { $papiClient } = useNuxtApp()
const session = useSessionStore()
const operations = useOperationsStore()
const didCommRepository = new DidCommRepository(
  $papiClient as { rpc(method: string, params?: unknown[]): Promise<unknown>; getEndpoint?(): string }
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
const submitting = ref(false)
const submitError = ref("")
const submittedTxHash = ref("")
const submittedMethod = ref("")

function logExtrinsicUpdate(update: ExtrinsicUpdate): void {
  const details = [update.message]
  if (update.txHash) {
    details.push(`tx: ${update.txHash}`)
  }
  if (update.blockHash) {
    details.push(`block: ${update.blockHash}`)
  }

  operations.add("bucket_write", `bucket:${update.stage}`, update.stage === "error" ? "error" : "info", details.join(" · "))
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
      logExtrinsicUpdate
    )
    submittedTxHash.value = result.txHash
    submittedMethod.value = result.method
    operations.add("bucket_write", bucketName.value.trim(), "success", `Bucket extrinsic submitted: ${result.txHash}`)
    bucketName.value = ""
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : "Unable to submit bucket extrinsic"
    operations.add("bucket_write", "bucket", "error", submitError.value)
  } finally {
    submitting.value = false
  }
}
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

      <section v-else class="card stack" aria-live="polite">
        <label class="stack" style="gap: 6px">
          <span>Namespace</span>
          <input class="input" type="text" :value="namespaceId" disabled />
        </label>

        <label class="stack" style="gap: 6px">
          <span>Bucket Name</span>
          <input v-model="bucketName" class="input" type="text" name="bucket-name" placeholder="e.g. primary-bucket"
            :disabled="submitting" />
        </label>

        <div class="row" style="justify-content: flex-end; gap: 8px">
          <NuxtLink class="btn" :to="namespaceRoutePath">Cancel</NuxtLink>
          <button class="btn" type="button" :disabled="submitting" @click="submitCreateBucket">
            {{ submitting ? "Submitting..." : "Submit Extrinsic" }}
          </button>
        </div>

        <p v-if="submitError" style="margin: 0; color: var(--status-error)">{{ submitError }}</p>
        <p v-if="submittedTxHash" style="margin: 0; color: var(--status-success)">
          Submitted via {{ submittedMethod }} successfully.
        </p>
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
