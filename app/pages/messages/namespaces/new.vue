<script setup lang="ts">
import { DidCommRepository, type ExtrinsicUpdate } from "../../../services/papi/didCommRepository"
import WalletConnectPrompt from "../../../components/common/WalletConnectPrompt.vue"
import { computed, ref } from "vue"
import { useNuxtApp } from "nuxt/app"
import { useOperationsStore } from "../../../stores/operations"
import { useSessionStore } from "../../../stores/session"

const { $papiClient } = useNuxtApp()
const session = useSessionStore()
const operations = useOperationsStore()
const didCommRepository = new DidCommRepository(
  $papiClient as { rpc(method: string, params?: unknown[]): Promise<unknown>; getEndpoint?(): string }
)

const isWalletConnected = computed(() => session.walletStatus === "connected" && Boolean(session.accountAddress))

const namespaceName = ref("")
const namespaceCategory = ref("")
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

  operations.add("bucket_write", `namespace:${update.stage}`, update.stage === "error" ? "error" : "info", details.join(" · "))
}

async function submitCreateNamespace(): Promise<void> {
  submitError.value = ""
  submittedTxHash.value = ""
  submittedMethod.value = ""

  if (!namespaceName.value.trim()) {
    submitError.value = "Namespace name is required"
    return
  }

  if (!session.accountAddress) {
    submitError.value = "Connect wallet before submitting buckets.createNamespace extrinsic"
    return
  }

  submitting.value = true

  try {
    const result = await didCommRepository.createNamespace(
      namespaceName.value,
      session.accountAddress,
      logExtrinsicUpdate,
      namespaceCategory.value
    )
    submittedTxHash.value = result.txHash
    submittedMethod.value = result.method
    operations.add("bucket_write", namespaceName.value.trim(), "success", `Namespace extrinsic submitted: ${result.txHash}`)
    namespaceName.value = ""
    namespaceCategory.value = ""
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : "Unable to submit namespace extrinsic"
    operations.add("bucket_write", "namespace", "error", submitError.value)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="stack namespace-create-page">
    <div class="row buckets-header" style="justify-content: space-between; align-items: center">
        <h3 style="margin: 0">Add namespace</h3>
      </div>
    <WalletConnectPrompt
      v-if="!isWalletConnected"
      title="Connect Your Wallet"
      description="Connect your wallet to create a namespace."
    />

    <section v-else class="card stack" style="gap: 10px" aria-live="polite">
      <label class="stack" style="gap: 6px">
        <span>Namespace name</span>
        <input
          v-model="namespaceName"
          class="input"
          type="text"
          name="namespace-name"
          placeholder="e.g. asset-messages"
          :disabled="submitting"
        />
      </label>

      <label class="stack" style="gap: 6px">
        <span>Category</span>
        <input
          v-model="namespaceCategory"
          class="input"
          type="text"
          name="namespace-category"
          placeholder="e.g. communication"
          :disabled="submitting"
        />
      </label>

      <div class="row" style="justify-content: flex-end">
        <button class="btn btn-primary" type="button" :disabled="submitting" @click="submitCreateNamespace">
          {{ submitting ? "Submitting..." : "Create" }}
        </button>
      </div>

      <p v-if="submitError" class="error-text">{{ submitError }}</p>
      <p v-if="submittedTxHash" class="success-text">
        Submitted via {{ submittedMethod }} successfully.
      </p>
    </section>
  </main>
</template>

<style scoped>
.namespace-create-page {
  padding: 0;
  max-width: 100%;
  margin: 0;
}

.namespace-actions {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.error-text {
  margin: 0;
  color: var(--status-error);
}

.success-text {
  margin: 0;
  color: var(--status-success);
}

@media (max-width: 720px) {
  .namespace-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .namespace-actions .btn {
    width: 100%;
  }
}
</style>
