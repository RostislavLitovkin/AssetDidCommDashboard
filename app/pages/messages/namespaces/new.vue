<script setup lang="ts">
import { DidCommRepository, type ExtrinsicUpdate } from "../../../services/papi/didCommRepository"
import { ref } from "vue"
import { useNuxtApp } from "nuxt/app"
import { useOperationsStore } from "../../../stores/operations"
import { useSessionStore } from "../../../stores/session"

const { $papiClient } = useNuxtApp()
const session = useSessionStore()
const operations = useOperationsStore()
const didCommRepository = new DidCommRepository(
  $papiClient as { rpc(method: string, params?: unknown[]): Promise<unknown>; getEndpoint?(): string }
)

const namespaceName = ref("")
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
    const result = await didCommRepository.createNamespace(namespaceName.value, session.accountAddress, logExtrinsicUpdate)
    submittedTxHash.value = result.txHash
    submittedMethod.value = result.method
    operations.add("bucket_write", namespaceName.value.trim(), "success", `Namespace extrinsic submitted: ${result.txHash}`)
    namespaceName.value = ""
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : "Unable to submit namespace extrinsic"
    operations.add("bucket_write", "namespace", "error", submitError.value)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="stack">
    <header class="card">
      <h2 style="margin: 0">Add Namespace</h2>
      <p class="muted" style="margin: 8px 0 0">Submit a create-namespace extrinsic to the Xcavate blockchain.</p>
    </header>

    <section class="card stack" aria-live="polite">
      <label class="stack" style="gap: 6px">
        <span>Namespace Name</span>
        <input
          v-model="namespaceName"
          class="input"
          type="text"
          name="namespace-name"
          placeholder="e.g. asset-messages"
          :disabled="submitting"
        />
      </label>

      <div class="row" style="justify-content: flex-end; gap: 8px">
        <NuxtLink class="btn" to="/messages">Cancel</NuxtLink>
        <button class="btn" type="button" :disabled="submitting" @click="submitCreateNamespace">
          {{ submitting ? "Submitting..." : "Submit Extrinsic" }}
        </button>
      </div>

      <p v-if="!session.accountAddress" class="muted" style="margin: 0">
        Connect wallet on the dashboard first to sign and submit this extrinsic.
      </p>

      <p v-if="submitError" style="margin: 0; color: var(--status-error)">{{ submitError }}</p>
      <p v-if="submittedTxHash" style="margin: 0; color: var(--status-success)">
        Submitted via {{ submittedMethod }} with hash {{ submittedTxHash }}
      </p>
    </section>
  </div>
</template>
