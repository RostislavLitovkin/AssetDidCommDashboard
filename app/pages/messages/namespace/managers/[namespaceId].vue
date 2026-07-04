<script setup lang="ts">
import { computed, ref } from "vue"
import { useNuxtApp, useRoute } from "nuxt/app"
import { DidCommRepository, type ExtrinsicUpdate } from "../../../../services/papi/didCommRepository"
import { useOperationsStore } from "../../../../stores/operations"
import { useSessionStore } from "../../../../stores/session"
import WalletConnectPrompt from "../../../../components/common/WalletConnectPrompt.vue"
import { ShieldCheck, UserPlus } from "lucide-vue-next"

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

  operations.add("namespace_write", `namespace-manager:${update.stage}`, update.stage === "error" ? "error" : "info", details.join(" · "))
}

async function submitAddManager(): Promise<void> {
  submitError.value = ""
  submittedTxHash.value = ""
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
    submitError.value = "Connect wallet before submitting namespace manager extrinsics"
    return
  }

  submitting.value = true

  try {
    const result = await didCommRepository.addNamespaceManager(
      namespaceId.value,
      managerAddress.value,
      session.accountAddress,
      logExtrinsicUpdate
    )

    submittedTxHash.value = result.txHash
    submittedMethod.value = result.method
    operations.add("namespace_write", namespaceId.value, "success", `Manager added: ${result.txHash}`)
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
        <div class="row buckets-header" style="justify-content: space-between; align-items: center">
          <div class="row" style="gap: 12px; align-items: center">
            <h3 style="margin: 0">Add Manager</h3>
          </div>
        </div>

        <WalletConnectPrompt v-if="!session.accountAddress" title="Connect Wallet to Manage Namespace"
          description="You must connect your wallet to submit manager management extrinsics." />

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
          <p v-if="submittedTxHash" style="margin: 0; color: var(--status-success); font-size: 13px;">
            Submitted via {{ submittedMethod }} with hash {{ submittedTxHash }}
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
