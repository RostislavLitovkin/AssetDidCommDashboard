<script setup lang="ts">
import type { OperationUpdate } from "../../../../services/buckets/types"
import WalletConnectPrompt from "../../../../components/common/WalletConnectPrompt.vue"
import PageHeader from "../../../../components/common/PageHeader.vue"
import SubmitButton from "../../../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../../../components/common/submitButtonView"
import { useSubmitState } from "../../../../composables/useSubmitState"
import { computed, ref } from "vue"
import { useRouter } from "vue-router"
import { useOperationsStore } from "../../../../stores/operations"
import { useSessionStore } from "../../../../stores/session"

const router = useRouter()
const session = useSessionStore()
const operations = useOperationsStore()
const bucketsRepository = useBucketsRepository()

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

// Drives the button only. The page logs one terminal entry per submit below —
// see the "Loggers drive phases; pages log outcomes" global constraint.
function logOperationUpdate(update: OperationUpdate): void {
  applySubmitUpdate(update)
}

async function submitCreateBucket(): Promise<void> {
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

  let createdId = ""
  await runSubmit(async () => {
    const result = await bucketsRepository.createBucket(
      null,
      name,
      address,
      logOperationUpdate,
      category.value
    )
    operations.add("bucket_write", "Create bucket", "success", `Bucket created: ${result.id}`)
    createdId = result.id
  })

  if (submitPhase.value === "error") {
    operations.add("bucket_write", "Create bucket", "error", submitError.value)
    return
  }

  // A standalone bucket is only reachable from My messages, so drop the user
  // straight into it — the setup timeline there guides members and keys.
  if (createdId) {
    await router.push(`/indexed-bucket/${encodeURIComponent(createdId)}`)
  }
}
</script>

<template>
  <div class="chat-custom-page">
    <div class="info-content-scroll stack">
      <PageHeader title="Add Bucket" />

      <WalletConnectPrompt v-if="!isWalletConnected" title="Connect Your Wallet"
        description="Connect your wallet to create a bucket." />

      <template v-else>
        <section class="card stack" aria-live="polite">
          <label class="stack" style="gap: 6px">
            <span>Bucket Name</span>
            <input v-model="bucketName" class="input" type="text" name="bucket-name" placeholder="e.g. primary-bucket"
              :disabled="submitting" @input="resetSubmit" />
          </label>

          <label class="stack" style="gap: 6px">
            <span>Category (Optional)</span>
            <input v-model="category" class="input" type="text" name="category" placeholder="e.g. communication"
              :disabled="submitting" @input="resetSubmit" />
          </label>

          <div class="row" style="justify-content: flex-end; gap: 8px">
            <SubmitButton
              :phase="submitPhase"
              :labels="submitLabels"
              @click="submitCreateBucket"
            />
          </div>

          <p v-if="submitError" style="margin: 0; color: var(--status-error)">{{ submitError }}</p>
        </section>
      </template>
    </div>
  </div>
</template>
