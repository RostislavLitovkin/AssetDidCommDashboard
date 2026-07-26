<script setup lang="ts">
import type { OperationUpdate } from "../../../services/buckets/types"
import WalletConnectPrompt from "../../../components/common/WalletConnectPrompt.vue"
import PageHeader from "../../../components/common/PageHeader.vue"
import { computed, ref } from "vue"
import { useOperationsStore } from "../../../stores/operations"
import { useSessionStore } from "../../../stores/session"

const bucketsRepository = useBucketsRepository()
const session = useSessionStore()
const operations = useOperationsStore()

const isWalletConnected = computed(() => session.walletStatus === "connected" && Boolean(session.accountAddress))

const namespaceName = ref("")
const submitting = ref(false)
const submitError = ref("")
const submittedId = ref("")
const submittedMethod = ref("")

function logOperationUpdate(update: OperationUpdate): void {
  operations.add("bucket_write", `namespace:${update.stage}`, update.stage === "error" ? "error" : "info", update.message)
}

async function submitCreateNamespace(): Promise<void> {
  submitError.value = ""
  submittedId.value = ""
  submittedMethod.value = ""

  if (!namespaceName.value.trim()) {
    submitError.value = "Namespace name is required"
    return
  }

  if (!session.accountAddress) {
    submitError.value = "Connect wallet before creating a namespace"
    return
  }

  submitting.value = true

  try {
    const result = await bucketsRepository.createNamespace(
      namespaceName.value,
      session.accountAddress,
      logOperationUpdate
    )
    submittedId.value = result.id
    submittedMethod.value = result.method
    operations.add("bucket_write", namespaceName.value.trim(), "success", `Namespace created: ${result.id}`)
    namespaceName.value = ""
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : "Unable to create namespace"
    operations.add("bucket_write", "namespace", "error", submitError.value)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="stack namespace-create-page">
    <PageHeader title="Add namespace" />
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



      <div class="row" style="justify-content: flex-end">
        <button class="btn btn-primary" type="button" :disabled="submitting" @click="submitCreateNamespace">
          {{ submitting ? "Submitting..." : "Create" }}
        </button>
      </div>

      <p v-if="submitError" class="error-text">{{ submitError }}</p>
      <p v-if="submittedId" class="success-text">
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
