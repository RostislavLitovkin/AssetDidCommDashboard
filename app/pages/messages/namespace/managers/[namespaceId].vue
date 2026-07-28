<script setup lang="ts">
import { computed, ref } from "vue"
import { useRoute } from "nuxt/app"
import type { OperationUpdate } from "../../../../services/buckets/types"
import { useOperationsStore } from "../../../../stores/operations"
import { useSessionStore } from "../../../../stores/session"
import { useSubmitState } from "../../../../composables/useSubmitState"
import WalletConnectPrompt from "../../../../components/common/WalletConnectPrompt.vue"
import PageHeader from "../../../../components/common/PageHeader.vue"
import SubmitButton from "../../../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../../../components/common/submitButtonView"

const route = useRoute()
const session = useSessionStore()
const operations = useOperationsStore()
const bucketsRepository = useBucketsRepository()

const {
  phase: submitPhase,
  errorMessage: submitError,
  applyUpdate: applySubmitUpdate,
  fail: failSubmit,
  reset: resetSubmit,
  run: runSubmit
} = useSubmitState()

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

const managerAddress = ref("")

const submitLabels: SubmitButtonLabels = {
  idle: "Add manager",
  signing: "Signing…",
  submitting: "Adding manager…",
  success: "Manager added",
  error: "Add failed — retry"
}

// Drives the button only. The page logs one terminal entry per submit below —
// see the "Loggers drive phases; pages log outcomes" global constraint.
function logOperationUpdate(update: OperationUpdate): void {
  applySubmitUpdate(update)
}

async function submitAddManager(): Promise<void> {
  const namespace = namespaceId.value.trim()
  if (!namespace) {
    failSubmit("Namespace id is required")
    return
  }

  const manager = managerAddress.value.trim()
  if (!manager) {
    failSubmit("Manager address is required")
    return
  }

  const address = session.accountAddress
  if (!address) {
    failSubmit("Connect wallet before adding a namespace manager")
    return
  }

  await runSubmit(async () => {
    const result = await bucketsRepository.addNamespaceManager(namespace, manager, address, logOperationUpdate)
    operations.add("namespace_write", "Add manager", "success", `Manager added: ${result.id}`)
    managerAddress.value = ""
  })

  if (submitPhase.value === "error") {
    operations.add("namespace_write", "Add manager", "error", submitError.value)
  }
}
</script>

<template>
  <div class="chat-custom-page">
    <div class="info-content-scroll stack">
      <section class="stack" aria-live="polite">
        <PageHeader title="Add Manager" />

        <WalletConnectPrompt v-if="!session.accountAddress" title="Connect Wallet to Manage Namespace"
          description="You must connect your wallet to manage namespace managers." />

        <div v-else class="card stack" style="gap: 16px;">
          <label class="stack" style="gap: 8px">
            <span style="font-weight: 600; font-size: 14px;">Manager Address</span>
            <input v-model="managerAddress" class="input" type="text" name="manager-address"
              placeholder="Enter SS58 address"
              :disabled="submitPhase === 'signing' || submitPhase === 'submitting'" @input="resetSubmit" />
          </label>

          <label class="stack" style="gap: 8px">
            <span style="font-weight: 600; font-size: 14px;">Namespace ID</span>
            <input class="input" type="text" :value="namespaceId" disabled />
          </label>

          <p v-if="submitError" style="margin: 0; color: var(--status-error); font-size: 13px;">{{ submitError }}</p>

          <div class="row" style="justify-content: flex-end; gap: 12px; margin-top: 8px;">
            <NuxtLink class="btn" :to="namespaceRoutePath">Cancel</NuxtLink>
            <SubmitButton
              :phase="submitPhase"
              :labels="submitLabels"
              :disabled="!managerAddress"
              @click="submitAddManager"
            />
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
