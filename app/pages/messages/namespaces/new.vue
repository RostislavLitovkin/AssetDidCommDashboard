<script setup lang="ts">
import type { OperationUpdate } from "../../../services/buckets/types"
import WalletConnectPrompt from "../../../components/common/WalletConnectPrompt.vue"
import PageHeader from "../../../components/common/PageHeader.vue"
import SubmitButton from "../../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../../components/common/submitButtonView"
import { computed, ref } from "vue"
import { useSubmitState } from "../../../composables/useSubmitState"
import { useOperationsStore } from "../../../stores/operations"
import { useSessionStore } from "../../../stores/session"

const bucketsRepository = useBucketsRepository()
const session = useSessionStore()
const operations = useOperationsStore()

const {
  phase: submitPhase,
  errorMessage: submitError,
  applyUpdate: applySubmitUpdate,
  fail: failSubmit,
  reset: resetSubmit,
  run: runSubmit
} = useSubmitState()

const isWalletConnected = computed(() => session.walletStatus === "connected" && Boolean(session.accountAddress))

const namespaceName = ref("")

const submitLabels: SubmitButtonLabels = {
  idle: "Create namespace",
  signing: "Signing…",
  submitting: "Creating namespace…",
  success: "Namespace created",
  error: "Create failed — retry"
}

function logOperationUpdate(update: OperationUpdate): void {
  applySubmitUpdate(update)
  // Signing drives the button only — logging it would add a notification popup
  // to every submit.
  if (update.stage === "signing") return
  operations.add("bucket_write", `namespace:${update.stage}`, update.stage === "error" ? "error" : "info", update.message)
}

async function submitCreateNamespace(): Promise<void> {
  const name = namespaceName.value.trim()
  if (!name) {
    failSubmit("Namespace name is required")
    return
  }

  const address = session.accountAddress
  if (!address) {
    failSubmit("Connect wallet before creating a namespace")
    return
  }

  await runSubmit(async () => {
    const result = await bucketsRepository.createNamespace(name, address, logOperationUpdate)
    operations.add("bucket_write", name, "success", `Namespace created: ${result.id}`)
    // Clearing programmatically does not fire @input, so the success state holds
    // until the user actually types again.
    namespaceName.value = ""
  })
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
          :disabled="submitPhase === 'signing' || submitPhase === 'submitting'"
          @input="resetSubmit"
        />
      </label>

      <div class="row" style="justify-content: flex-end">
        <SubmitButton :phase="submitPhase" :labels="submitLabels" @click="submitCreateNamespace" />
      </div>

      <p v-if="submitError" class="error-text">{{ submitError }}</p>
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
