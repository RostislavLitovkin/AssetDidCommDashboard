<script setup lang="ts">
import type { OperationUpdate } from "../../../../services/buckets/types"
import WalletConnectPrompt from "../../../../components/common/WalletConnectPrompt.vue"
import PageHeader from "../../../../components/common/PageHeader.vue"
import ParticleLoader from "../../../../components/common/ParticleLoader.vue"
import SubmitButton from "../../../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../../../components/common/submitButtonView"
import { useSubmitState } from "../../../../composables/useSubmitState"
import { ShieldAlert } from "lucide-vue-next"
import { computed, onMounted, ref } from "vue"
import { useRoute } from "nuxt/app"
import { useOperationsStore } from "../../../../stores/operations"
import { useSessionStore } from "../../../../stores/session"
import { useAddress } from "../../../../composables/useAddress"

const route = useRoute()
const session = useSessionStore()
const operations = useOperationsStore()
const { addressesEqual } = useAddress()
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
const isWalletConnected = computed(() => session.walletStatus === "connected" && Boolean(session.accountAddress))

const {
  phase: submitPhase,
  errorMessage: submitError,
  applyUpdate: applySubmitUpdate,
  fail: failSubmit,
  reset: resetSubmit,
  run: runSubmit
} = useSubmitState()

const bucketName = ref("")
const category = ref("")

const submitLabels: SubmitButtonLabels = {
  idle: "Create bucket",
  signing: "Signing…",
  submitting: "Creating bucket…",
  success: "Bucket created",
  error: "Create failed — retry"
}

const submitting = computed(() => submitPhase.value === "signing" || submitPhase.value === "submitting")

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
    managers.value = await bucketsRepository.fetchNamespaceManagers(namespaceId.value)
  } catch {
    managers.value = []
  } finally {
    managersLoading.value = false
  }
}

// Drives the button only. The page logs one terminal entry per submit below —
// see the "Loggers drive phases; pages log outcomes" global constraint.
function logOperationUpdate(update: OperationUpdate): void {
  applySubmitUpdate(update)
}

async function submitCreateBucket(): Promise<void> {
  const namespace = namespaceId.value.trim()
  if (!namespace) {
    failSubmit("Namespace id is required")
    return
  }

  const name = bucketName.value.trim()
  if (!name) {
    failSubmit("Bucket name is required")
    return
  }

  const address = session.accountAddress
  if (!address) {
    failSubmit("Connect wallet before creating a bucket")
    return
  }

  await runSubmit(async () => {
    const result = await bucketsRepository.createBucket(
      namespace,
      name,
      address,
      logOperationUpdate,
      category.value
    )
    operations.add("bucket_write", "Create bucket", "success", `Bucket created: ${result.id}`)
    bucketName.value = ""
    category.value = ""
  })

  if (submitPhase.value === "error") {
    operations.add("bucket_write", "Create bucket", "error", submitError.value)
  }
}

onMounted(async () => {
  await loadManagers()
})
</script>

<template>
  <div class="chat-custom-page">
    <div class="info-content-scroll stack">
      <PageHeader title="Add Bucket" />

      <WalletConnectPrompt v-if="!isWalletConnected" title="Connect Your Wallet"
        description="Connect your wallet to create a bucket in this namespace." />

      <template v-else>
        <!-- Manager check loading -->
        <ParticleLoader v-if="managersLoading" label="Checking namespace permissions..." />

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
              :disabled="submitting || (!managersLoading && !isManager)" @input="resetSubmit" />
          </label>

          <label class="stack" style="gap: 6px">
            <span>Category (Optional)</span>
            <input v-model="category" class="input" type="text" name="category" placeholder="e.g. communication"
              :disabled="submitting || (!managersLoading && !isManager)" @input="resetSubmit" />
          </label>

          <div class="row" style="justify-content: flex-end; gap: 8px">
            <SubmitButton
              :phase="submitPhase"
              :labels="submitLabels"
              :disabled="managersLoading || !isManager"
              @click="submitCreateBucket"
            />
          </div>

          <p v-if="submitError" style="margin: 0; color: var(--status-error)">{{ submitError }}</p>
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
