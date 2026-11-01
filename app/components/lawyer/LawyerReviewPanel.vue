<script setup lang="ts">
import { computed, ref, useId, watch } from "vue"
import type {
  LawyerListingStatus,
  LawyerReviewBucketMetadata,
  LawyerReviewState,
  LawyerReviewTallies,
  LawyerSeatState,
} from "../../services/lawyer/types"

const props = withDefaults(defineProps<{
  metadata: LawyerReviewBucketMetadata
  review: LawyerReviewState | null
  documentsHash?: string
  loading?: boolean
  error?: string
  actionError?: string
  notice?: string
  transactionSignatures?: string[]
  eligibleLawyer?: boolean
  missingDocuments?: boolean
  canUpload?: boolean
  confirming?: boolean
  submissionAllowed?: boolean
  walletAddress?: string
  walletConnected?: boolean
  executeAllowed?: boolean
  executing?: boolean
}>(), {
  documentsHash: "",
  loading: false,
  error: "",
  actionError: "",
  notice: "",
  transactionSignatures: () => [],
  eligibleLawyer: false,
  missingDocuments: false,
  canUpload: false,
  confirming: false,
  submissionAllowed: false,
  walletAddress: "",
  walletConnected: false,
  executeAllowed: true,
  executing: false,
})

const emit = defineEmits<{
  confirm: [approve: boolean]
  execute: []
  upload: []
  retry: []
}>()

const id = useId()
const selectedVerdict = ref<"approve" | "reject">("approve")
const confirmationSent = ref(false)
const transactionLinks = computed(() => props.transactionSignatures.map((signature) => ({
  signature,
  url: `https://solscan.io/tx/${encodeURIComponent(signature)}${props.metadata.cluster === "devnet" ? "?cluster=devnet" : ""}`,
})))

const hasDocumentSet = computed(() => !props.missingDocuments && Boolean(props.documentsHash.trim()))
const invalidReview = computed(() => Boolean(props.review?.staleAssignment || props.review?.hashMismatch))
const closedReview = computed(() => props.review !== null && [
  "LEGAL",
  "FINALIZED",
  "EXPIRED",
  "CANCELLED",
  "REFUNDING",
].includes(props.review.status))
const confirmDisabled = computed(() =>
  props.loading
  || props.confirming
  || confirmationSent.value
  || !props.submissionAllowed
  || !hasDocumentSet.value
  || invalidReview.value
  || closedReview.value
  || Boolean(props.error)
)
const executeEligible = computed(() =>
  Boolean(
    props.walletConnected
    && props.executeAllowed
    && props.review?.settlementReady
    && !invalidReview.value
    && !props.loading
    && !props.error
  )
)
const executionMessage = computed(() => {
  if (props.review?.settlementReady && props.executeAllowed && !invalidReview.value) {
    return props.walletConnected
      ? "The deal is ready. Any connected wallet can execute it."
      : "Connect a wallet to execute the ready deal."
  }
  return "Execute deal is not ready. Both lawyer approvals and settlement evidence are required."
})

const meters = computed(() => {
  const entries: Array<{ key: keyof LawyerReviewTallies; label: string }> = [
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "pending", label: "Pending" },
  ]
  return entries.map(({ key, label }) => ({
    key,
    label,
    id: `${id}-${key}`,
    descriptionId: `${id}-${key}-value`,
    count: props.review?.counts[key] ?? 0,
    percentage: props.review?.percentages[key] ?? 0,
  }))
})

function formatStatus(status: LawyerListingStatus): string {
  const labels: Record<LawyerListingStatus, string> = {
    PENDING_ASSETS: "Pending assets",
    LISTED: "Listed",
    SOLD_OUT: "Sold out",
    LEGAL: "Legal",
    FINALIZED: "Finalized",
    EXPIRED: "Expired",
    CANCELLED: "Cancelled",
    REFUNDING: "Refunding",
  }
  return labels[status]
}

function formatDeadline(seconds: number): string {
  const date = new Date(seconds * 1000)
  return Number.isFinite(seconds) && !Number.isNaN(date.getTime())
    ? date.toISOString().replace("T", " ").replace(".000Z", " UTC")
    : "Unavailable"
}

function shortHash(hash: string): string {
  const trimmed = hash.trim()
  return trimmed.length > 18 ? `${trimmed.slice(0, 10)}…${trimmed.slice(-8)}` : trimmed
}

function seatLabel(seat: LawyerSeatState): string {
  return seat.role === "spv" ? "SPV lawyer" : "Developer lawyer"
}

function submitConfirmation(): void {
  if (!props.eligibleLawyer || confirmDisabled.value) return
  confirmationSent.value = true
  emit("confirm", selectedVerdict.value === "approve")
}

watch(() => props.actionError, (message) => {
  if (message) confirmationSent.value = false
})

watch(() => [props.documentsHash, props.review?.attempt, props.walletAddress], (current, previous) => {
  if (current.some((value, index) => value !== previous[index])) confirmationSent.value = false
})
</script>

<template>
  <section class="card lawyer-review" :aria-labelledby="`${id}-title`" :aria-busy="props.loading">
    <header class="review-header">
      <div>
        <h2 :id="`${id}-title`">Lawyer document review</h2>
        <p class="review-property">Property {{ metadata.propertyId }} <span aria-hidden="true">·</span> {{ metadata.cluster }}</p>
      </div>
    </header>

    <p v-if="notice" class="review-notice" role="status" aria-live="polite">{{ notice }}</p>
    <ul v-if="transactionLinks.length" class="transaction-links" aria-label="Submitted transactions">
      <li v-for="link in transactionLinks" :key="link.signature">
        <a :href="link.url" target="_blank" rel="noopener">View transaction {{ link.signature }}</a>
      </li>
    </ul>
    <div v-if="error" class="review-error" role="alert">
      <p>{{ error }}</p>
      <button class="btn" type="button" @click="emit('retry')">Retry review</button>
    </div>
    <p v-if="actionError" class="review-error" role="alert">{{ actionError }}</p>

    <p v-if="props.loading && !review" class="review-loading" role="status" aria-live="polite">
      Loading lawyer review…
    </p>
    <p v-else-if="error && !review" class="muted">Review details could not be loaded.</p>
    <p v-else-if="!review" class="review-loading" role="status">Lawyer review is unavailable.</p>

    <template v-else>
      <dl class="review-summary">
        <div>
          <dt>Attempt</dt>
          <dd>Attempt {{ review.attempt }} of 2</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{{ formatStatus(review.status) }}</dd>
        </div>
        <div class="review-deadline">
          <dt>Legal deadline</dt>
          <dd>{{ formatDeadline(review.legalDeadline) }}</dd>
        </div>
      </dl>

      <p v-if="review.attempt === 2" class="attempt-notice" role="status">
        Second review attempt. Both lawyers must review the current document set.
      </p>
      <p v-if="review.staleAssignment" class="review-error" role="alert">
        Lawyer assignments changed on-chain. This review bucket is stale; transactions are disabled.
      </p>
      <p v-else-if="review.hashMismatch" class="review-error" role="alert">
        The approved seats reference different document hashes. Transactions are disabled.
      </p>
      <div v-if="!hasDocumentSet" class="missing-documents" role="alert">
        <p>One or both lawyer documents are missing. The current document-set hash is unavailable.</p>
        <button v-if="canUpload" class="btn" type="button" @click="emit('upload')">
          Upload replacement document
        </button>
      </div>

      <div class="document-hash">
        <span>Current document-set hash</span>
        <code v-if="hasDocumentSet" :title="documentsHash">{{ shortHash(documentsHash) }}</code>
        <span v-else>Unavailable</span>
      </div>

      <ul class="seat-list" aria-label="Lawyer verdicts">
        <li v-for="seat in [review.spv, review.developer]" :key="seat.role" class="seat-card">
          <h3>{{ seatLabel(seat) }}</h3>
          <p class="seat-verdict" :class="`verdict-${seat.verdict}`">{{ seat.verdict }}</p>
          <code class="seat-wallet">{{ seat.wallet }}</code>
          <span class="seat-hash">Document hash: <code>{{ seat.documentsHash }}</code></span>
        </li>
      </ul>

      <div class="meter-list" aria-label="Two-seat review totals">
        <div v-for="meter in meters" :key="meter.key" class="review-meter" :class="`meter-${meter.key}`">
          <div class="meter-heading">
            <label :for="meter.id">{{ meter.label }}</label>
            <span :id="meter.descriptionId">{{ meter.count }} of 2 · {{ meter.percentage }}%</span>
          </div>
          <progress
            :id="meter.id"
            :value="meter.percentage"
            max="100"
            :aria-describedby="meter.descriptionId"
          >{{ meter.percentage }}%</progress>
        </div>
      </div>

      <p v-if="!eligibleLawyer" class="read-only">
        Read-only review. Only the currently assigned SPV and developer lawyers can confirm documents.
      </p>
      <form v-else class="verdict-form" @submit.prevent="submitConfirmation">
        <fieldset :disabled="confirmDisabled">
          <legend>Document verdict</legend>
          <p v-if="hasDocumentSet" class="hash-confirmation">
            Confirm this exact document set: <code :title="documentsHash">{{ shortHash(documentsHash) }}</code>
          </p>
          <div class="verdict-options">
            <label class="verdict-option">
              <input
                :name="`${id}-verdict`"
                type="radio"
                value="approve"
                :checked="selectedVerdict === 'approve'"
                required
                @change="selectedVerdict = 'approve'"
              >
              Approve
            </label>
            <label class="verdict-option">
              <input
                :name="`${id}-verdict`"
                type="radio"
                value="reject"
                :checked="selectedVerdict === 'reject'"
                required
                @change="selectedVerdict = 'reject'"
              >
              Reject
            </label>
          </div>
          <button class="btn btn-primary verdict-submit" type="submit" :disabled="confirmDisabled" :aria-busy="props.confirming">
            {{ props.confirming ? "Submitting review…" : confirmationSent ? "Submitted review" : "Submit document verdict" }}
          </button>
        </fieldset>
      </form>

      <div class="execute-deal">
        <h3>Execute deal</h3>
        <p>{{ executionMessage }}</p>
        <button
          v-if="executeEligible"
          class="btn btn-primary"
          type="button"
          :disabled="props.executing"
          :aria-busy="props.executing"
          @click="emit('execute')"
        >{{ props.executing ? "Executing deal…" : "Execute deal" }}</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.lawyer-review {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 16px;
  color: var(--text-primary);
}

.review-header,
.meter-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.review-header h2,
.seat-card h3,
.execute-deal h3 {
  margin: 0;
}

.review-header h2 {
  font-size: 20px;
}

.review-property,
.review-loading,
.attempt-notice,
.read-only,
.execute-deal p,
.hash-confirmation {
  margin: 4px 0 0;
  color: var(--text-secondary);
}

.review-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.review-summary div {
  min-width: 0;
}

.review-summary dt {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.review-summary dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  font-weight: 600;
}

.review-notice,
.review-error,
.missing-documents {
  margin: 0;
  border-radius: 8px;
  padding: 12px;
}

.review-notice {
  background: color-mix(in srgb, var(--status-success) 10%, transparent);
  color: var(--status-success);
}

.review-error,
.missing-documents {
  background: color-mix(in srgb, var(--status-error) 8%, transparent);
  color: var(--status-error);
}

.review-error p,
.missing-documents p {
  margin: 0;
}

.review-error .btn,
.missing-documents .btn {
  margin-top: 12px;
}

.document-hash {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--text-secondary);
  font-size: 13px;
}

code {
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;
}

.document-hash code,
.hash-confirmation code {
  color: var(--text-primary);
  font-weight: 600;
}

.seat-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.seat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  padding: 12px;
}

.seat-card h3 {
  font-size: 15px;
}

.seat-verdict {
  align-self: flex-start;
  margin: 0;
  border-radius: 999px;
  padding: 2px 8px;
  background: var(--surface-bg);
  font-size: 12px;
  font-weight: 700;
  text-transform: capitalize;
}

.verdict-approved {
  color: var(--status-success);
}

.verdict-rejected {
  color: var(--status-error);
}

.verdict-pending {
  color: var(--status-warning);
}

.seat-wallet,
.seat-hash {
  overflow-wrap: anywhere;
  font-size: 12px;
}

.seat-hash {
  color: var(--text-secondary);
}

.meter-list {
  display: grid;
  gap: 12px;
}

.review-meter {
  display: grid;
  gap: 6px;
}

.meter-heading {
  font-size: 13px;
}

.meter-heading label {
  font-weight: 600;
}

.meter-heading span {
  color: var(--text-secondary);
}

.review-meter progress {
  display: block;
  width: 100%;
  height: 12px;
  accent-color: var(--color-primary);
}

.meter-approved progress {
  accent-color: var(--status-success);
}

.meter-rejected progress {
  accent-color: var(--status-error);
}

.meter-pending progress {
  accent-color: var(--status-warning);
}

.verdict-form fieldset {
  min-width: 0;
  margin: 0;
  border: 0;
  padding: 0;
}

.verdict-form legend {
  padding: 0;
  font-weight: 700;
}

.verdict-options {
  display: flex;
  gap: 12px;
  margin: 12px 0;
}

.verdict-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 48px;
  min-height: 48px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 10px 14px;
  cursor: pointer;
}

.verdict-option:has(input:checked) {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}

.verdict-option input {
  width: 20px;
  height: 20px;
  margin: 0;
}

.lawyer-review .btn {
  min-width: 48px;
  min-height: 48px;
  padding: 11px 16px;
}

.verdict-submit {
  width: 100%;
}

.execute-deal {
  border-top: 1px solid var(--border-default);
  padding-top: 16px;
}

.execute-deal h3 {
  font-size: 16px;
}

.execute-deal .btn {
  width: 100%;
  margin-top: 12px;
}

@media (max-width: 640px) {
  .review-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .review-deadline {
    grid-column: 1 / -1;
  }

  .seat-list {
    grid-template-columns: 1fr;
  }

  .verdict-options {
    flex-direction: column;
  }
}

@media (max-width: 380px) {
  .review-summary {
    grid-template-columns: 1fr;
  }

  .review-deadline {
    grid-column: auto;
  }
}
</style>
