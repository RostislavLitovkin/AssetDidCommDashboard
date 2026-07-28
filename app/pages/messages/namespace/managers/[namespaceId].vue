<script setup lang="ts">
import { computed, ref } from "vue"
import { useRoute } from "nuxt/app"
import type { OperationUpdate } from "../../../../services/buckets/types"
import { useOperationsStore } from "../../../../stores/operations"
import { useSessionStore } from "../../../../stores/session"
import WalletConnectPrompt from "../../../../components/common/WalletConnectPrompt.vue"
import PageHeader from "../../../../components/common/PageHeader.vue"
import { ShieldCheck, UserPlus } from "lucide-vue-next"

const route = useRoute()
const session = useSessionStore()
const operations = useOperationsStore()
const bucketsRepository = useBucketsRepository()

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
const submitting = ref(false)
const submitError = ref("")
const submittedId = ref("")
const submittedMethod = ref("")

function logOperationUpdate(update: OperationUpdate): void {
  // Signing drives the submit button only — logging it would add a notification
  // popup to every signed operation.
  if (update.stage === "signing") return
  operations.add("namespace_write", `namespace-manager:${update.stage}`, update.stage === "error" ? "error" : "info", update.message)
}

async function submitAddManager(): Promise<void> {
  submitError.value = ""
  submittedId.value = ""
  submittedMethod.value = ""

  if (!namespaceId.value.trim()) {
    submitError.value = "Namespace id is required"
    return
  }

  if (!managerAddress.value.trim()) {
    submitError.value = "Manager address is required"
    return
  }

  if (!session.accountAddress) {
    submitError.value = "Connect wallet before submitting namespace manager mutations"
    return
  }

  submitting.value = true

  try {
    const result = await bucketsRepository.addNamespaceManager(
      namespaceId.value,
      managerAddress.value,
      session.accountAddress,
      logOperationUpdate
    )

    submittedId.value = result.id
    submittedMethod.value = result.method
    operations.add("namespace_write", namespaceId.value, "success", `Manager added: ${result.id}`)
    managerAddress.value = ""
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : "Unable to add namespace manager"
    operations.add("namespace_write", `namespace:${namespaceId.value}`, "error", submitError.value)
  } finally {
    submitting.value = false
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
              placeholder="Enter SS58 address" :disabled="submitting" />
          </label>

          <label class="stack" style="gap: 8px">
            <span style="font-weight: 600; font-size: 14px;">Namespace ID</span>
            <input class="input" type="text" :value="namespaceId" disabled />
          </label>

          <p v-if="submitError" style="margin: 0; color: var(--status-error); font-size: 13px;">{{ submitError }}</p>
          <p v-if="submittedId" style="margin: 0; color: var(--status-success); font-size: 13px;">
            Submitted via {{ submittedMethod }} with id {{ submittedId }}
          </p>

          <div class="row" style="justify-content: flex-end; gap: 12px; margin-top: 8px;">
            <NuxtLink class="btn" :to="namespaceRoutePath">Cancel</NuxtLink>
            <button class="btn btn-primary" type="button" :disabled="submitting || !managerAddress"
              @click="submitAddManager">
              {{ submitting ? "Submitting..." : "Add Manager" }}
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
