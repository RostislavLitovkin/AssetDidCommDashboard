<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from "vue"
import { Vote } from "lucide-vue-next"
import { votingTimeLeftLabel } from "../../services/buckets/voting"
import type {
  LawyerListingStatus,
  LawyerReviewBucketMetadata,
  LawyerReviewState,
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

type SheetAction = "approve" | "reject" | "execute"

const id = useId()
const sheetAction = ref<SheetAction | null>(null)
const sheetRef = ref<HTMLDialogElement | null>(null)
const sheetGuidance = ref("")
const confirmationSent = ref(false)
const now = ref(Date.now())
let deadlineTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  deadlineTimer = setInterval(() => { now.value = Date.now() }, 1000)
})

onUnmounted(() => {
  if (deadlineTimer !== undefined) clearInterval(deadlineTimer)
})

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
const deadlineExpired = computed(() =>
  props.review !== null && Math.floor(now.value / 1000) > props.review.legalDeadline
)
/** ISO form of the on-chain deadline, undefined when the review has no usable one. */
const deadlineExpiry = computed<string | undefined>(() => {
  const seconds = props.review?.legalDeadline
  if (seconds === undefined) return undefined
  const ms = seconds * 1000
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return undefined
  return new Date(ms).toISOString()
})
/** The governance banner's relative countdown, driven by the panel's 1s clock. */
const timeLeftLabel = computed(() => votingTimeLeftLabel(deadlineExpiry.value, now.value))
const expiryMessage = "The legal review deadline has passed. Reload the review before taking another action."
const confirmDisabled = computed(() =>
  props.loading
  || props.confirming
  || confirmationSent.value
  || !props.submissionAllowed
  || !hasDocumentSet.value
  || invalidReview.value
  || closedReview.value
  || deadlineExpired.value
  || Boolean(props.error)
)
const executeEligible = computed(() =>
  Boolean(
    props.walletConnected
    && props.executeAllowed
    && props.review?.settlementReady
    && !invalidReview.value
    && !deadlineExpired.value
    && !props.loading
    && !props.error
  )
)
const executionMessage = computed(() => {
  if (deadlineExpired.value) return expiryMessage
  if (props.review?.settlementReady && props.executeAllowed && !invalidReview.value) {
    return props.walletConnected
      ? "The deal is ready. Any connected wallet can execute it."
      : "Connect a wallet to execute the ready deal."
  }
  return "Finalize deal is not ready. Both lawyer approvals and settlement evidence are required."
})
const sheetBusy = computed(() =>
  sheetAction.value === "execute" ? props.executing : props.confirming
)
const sheetSubmitDisabled = computed(() =>
  sheetBusy.value
  || deadlineExpired.value
  || (sheetAction.value === "execute" ? !executeEligible.value : confirmDisabled.value)
)
const sheetTitle = computed(() => {
  switch (sheetAction.value) {
    case "approve": return "Approve documents"
    case "reject": return "Reject documents"
    case "execute": return "Finalize deal"
    default: return ""
  }
})
const sheetDescription = computed(() => {
  switch (sheetAction.value) {
    case "approve":
      return "I reviewed both current documents and approve this exact document set."
    case "reject":
      return "I reject this exact document set and request a revision."
    case "execute":
      return "Both assigned lawyers approved this document set. Execute the ready Solana settlement now."
    default:
      return ""
  }
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

async function openSheet(action: SheetAction): Promise<void> {
  if (action === "execute") {
    if (!executeEligible.value || props.executing) return
  } else if (!props.eligibleLawyer || confirmDisabled.value) {
    return
  }
  sheetGuidance.value = ""
  sheetAction.value = action
  await nextTick()
  sheetRef.value?.showModal?.()
}

function finishSheet(): void {
  sheetAction.value = null
  sheetGuidance.value = ""
}

function closeSheet(): void {
  if (sheetBusy.value) {
    sheetGuidance.value = "Wait for the wallet transaction to finish before closing this sheet."
    return
  }
  if (sheetRef.value?.open) sheetRef.value.close()
  else finishSheet()
}

function onSheetCancel(event: Event): void {
  if (!sheetBusy.value) return
  event.preventDefault()
  sheetGuidance.value = "Wait for the wallet transaction to finish before closing this sheet."
}

function submitSheet(): void {
  const action = sheetAction.value
  if (!action || sheetBusy.value) return
  if (action === "execute") {
    if (!executeEligible.value) return
    emit("execute")
    return
  }
  if (confirmDisabled.value) return
  confirmationSent.value = true
  emit("confirm", action === "approve")
}

watch(() => props.actionError, (message) => {
  if (message) confirmationSent.value = false
})

watch(() => [props.documentsHash, props.review?.attempt, props.walletAddress], (current, previous) => {
  if (current.some((value, index) => value !== previous[index])) confirmationSent.value = false
})

watch(() => [props.confirming, props.executing], (current, previous) => {
  const finished = (previous[0] && !current[0]) || (previous[1] && !current[1])
  if (finished && !props.actionError && sheetRef.value?.open) sheetRef.value.close()
})
</script>

<template>
  <section class="lawyer-review-shell" :aria-busy="props.loading">
    <div class="ib-offer-bar" role="region" aria-label="Lawyer document review">
      <div class="ib-offer-inner">
        <div class="ib-offer-head">
          <Vote :size="18" class="ib-offer-icon" aria-hidden="true" />
          <div class="ib-offer-info">
            <h2 :id="`${id}-title`" class="ib-offer-title">Lawyer document review</h2>
            <p class="ib-offer-amount review-property">Property {{ metadata.propertyId }} · {{ metadata.cluster }}</p>
            <p v-if="review" class="ib-offer-amount review-status-line">
              {{ formatStatus(review.status) }} ·
              {{ review.counts.approved }} of 2 approved ({{ review.percentages.approved }}%) ·
              {{ review.counts.rejected }} rejected ({{ review.percentages.rejected }}%) ·
              {{ review.counts.pending }} pending ({{ review.percentages.pending }}%)
            </p>
            <p v-else class="ib-offer-amount">Two assigned lawyers review the current documents.</p>
            <p v-if="review && deadlineExpiry" class="ib-offer-amount">{{ timeLeftLabel }}</p>
          </div>
        </div>

        <p v-if="props.loading && !review" class="review-loading" role="status" aria-live="polite">
          Loading lawyer review…
        </p>
        <p v-else-if="!review" class="review-loading" role="status">
          {{ error ? "Review details could not be loaded." : "Lawyer review is unavailable." }}
        </p>

        <div v-if="error" class="review-error" role="alert">
          <span>{{ error }}</span>
          <button class="btn ib-offer-action" type="button" @click="emit('retry')">Retry review</button>
        </div>

        <p v-if="review?.staleAssignment" class="review-error" role="alert">
          Lawyer assignments changed on-chain. This review bucket is stale; transactions are disabled.
        </p>
        <p v-else-if="review?.hashMismatch" class="review-error" role="alert">
          The decided lawyer seats reference different document hashes. Transactions are disabled.
        </p>
        <p v-if="deadlineExpired && !sheetAction" class="review-error" role="alert">{{ expiryMessage }}</p>

        <div v-if="!hasDocumentSet && review" class="review-error" role="alert">
          <span>One or both lawyer documents are missing. The current document-set hash is unavailable.</span>
          <button v-if="canUpload" class="btn ib-offer-action" type="button" @click="emit('upload')">
            Upload replacement document
          </button>
        </div>

        <div v-if="executeEligible" class="ib-offer-actions">
          <button class="btn btn-primary ib-offer-action" type="button" :disabled="props.executing"
            :aria-busy="props.executing" @click="openSheet('execute')">
            {{ props.executing ? "Finalizing…" : "Finalize deal" }}
          </button>
        </div>
        <div v-else-if="eligibleLawyer && review" class="ib-offer-actions">
          <button class="btn btn-primary ib-offer-action" type="button" :disabled="confirmDisabled" @click="openSheet('approve')">
            Approve documents
          </button>
          <button class="btn ib-vote-reject ib-offer-action" type="button" :disabled="confirmDisabled" @click="openSheet('reject')">
            Reject documents
          </button>
        </div>
        <p v-else-if="review" class="ib-offer-note">
          Read-only review. Only the currently assigned SPV and developer lawyers can confirm documents.
        </p>
        <p v-if="review?.settlementReady && !executeEligible" class="ib-offer-note execution-guidance" role="status" aria-live="polite">
          {{ executionMessage }}
        </p>

        <p v-if="notice" class="review-notice" role="status" aria-live="polite">{{ notice }}</p>
        <p v-if="actionError && !sheetAction" class="review-error" role="alert">{{ actionError }}</p>
        <ul v-if="transactionLinks.length" class="transaction-links" aria-label="Submitted transactions">
          <li v-for="link in transactionLinks" :key="link.signature">
            <a :href="link.url" target="_blank" rel="noopener">View transaction {{ link.signature }}</a>
          </li>
        </ul>

        <details v-if="review" class="review-details">
          <summary>Review details</summary>
          <div class="review-details-body">
            <dl class="review-summary">
              <div><dt>Attempt</dt><dd>Attempt {{ review.attempt }} of 2</dd></div>
              <div><dt>Status</dt><dd>{{ formatStatus(review.status) }}</dd></div>
              <div><dt>Legal deadline</dt><dd>{{ formatDeadline(review.legalDeadline) }}</dd></div>
            </dl>
            <p v-if="review.attempt === 2" class="attempt-notice" role="status">
              Second review attempt. Both lawyers must review the current document set.
            </p>
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
            <p v-if="!review.settlementReady" class="execution-message">{{ executionMessage }}</p>
          </div>
        </details>
      </div>
    </div>

    <dialog
      v-if="sheetAction"
      ref="sheetRef"
      class="card ib-offer-sheet"
      closedby="any"
      :aria-labelledby="`${id}-sheet-title`"
      :aria-describedby="`${id}-sheet-description`"
      @cancel="onSheetCancel"
      @close="finishSheet"
    >
      <div class="ib-sheet-handle" aria-hidden="true"></div>
      <h3 :id="`${id}-sheet-title`" class="ib-sheet-title">{{ sheetTitle }}</h3>
      <p :id="`${id}-sheet-description`" class="muted ib-sheet-desc">{{ sheetDescription }}</p>
      <p v-if="sheetAction !== 'execute' && hasDocumentSet" class="document-hash sheet-hash">
        Document set: <code :title="documentsHash">{{ shortHash(documentsHash) }}</code>
      </p>
      <p v-if="deadlineExpired" class="ib-sheet-error" role="alert">{{ expiryMessage }}</p>
      <p v-if="actionError" class="ib-sheet-error" role="alert">{{ actionError }}</p>
      <p v-if="sheetGuidance || sheetBusy" class="sheet-guidance" role="status" aria-live="polite">
        {{ sheetGuidance || "Confirm the transaction in your wallet. This sheet stays open until submission finishes." }}
      </p>
      <div class="ib-sheet-actions">
        <button class="btn" type="button" autofocus :disabled="sheetBusy" @click="closeSheet">Cancel</button>
        <button class="btn btn-primary" type="button" :disabled="sheetSubmitDisabled" @click="submitSheet">
          {{ sheetBusy ? "Submitting…" : sheetAction === "execute" ? "Execute deal" : "Submit review" }}
        </button>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.lawyer-review-shell {
  flex-shrink: 0;
  color: var(--text-primary);
}

/* The banner (.ib-offer-*), the sheet (.ib-offer-sheet and its .ib-sheet-* parts)
   and the plain success notice (shared with .ib-vote-notice) all live in
   ~/assets/styles/ib-surfaces.css — the same rule set the SPV lawyer terms flow
   wears. Only what the review flow's own content needs is left here. */

/* The two-seat tally is one long line, so it has to break inside words. */
.review-status-line {
  overflow-wrap: anywhere;
}

/* Review errors surface inside the banner, where the reference flow shows none,
   and several carry an inline action button — hence a boxed alert rather than the
   sheet's bare .ib-sheet-error text. */
.review-error {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  background: color-mix(in srgb, var(--status-error) 8%, transparent);
  color: var(--status-error);
}

.review-loading,
.attempt-notice,
.execution-message {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.transaction-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin: 0;
  padding-left: 20px;
  font-size: 12px;
}

.review-details {
  font-size: 13px;
}

.review-details summary {
  width: fit-content;
  cursor: pointer;
  color: var(--text-secondary);
  font-weight: 600;
}

.review-details-body {
  display: grid;
  gap: 12px;
  padding-top: 12px;
}

.review-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
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

.document-hash code {
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
  gap: 4px;
  min-width: 0;
  border-top: 1px solid var(--border-default);
  padding-top: 8px;
}

.seat-card h3,
.seat-verdict {
  margin: 0;
  font-size: 13px;
}

.seat-verdict {
  font-weight: 700;
  text-transform: capitalize;
}

.verdict-approved { color: var(--status-success); }
.verdict-rejected { color: var(--status-error); }
.verdict-pending { color: var(--status-warning); }

.seat-wallet,
.seat-hash {
  overflow-wrap: anywhere;
  font-size: 12px;
}

.seat-hash {
  color: var(--text-secondary);
}

/* Guidance line inside the sheet — the reference sheet has no equivalent element. */
.sheet-guidance {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}

/* The review details grid, not part of the shared banner/sheet rule set. */
@media (max-width: 640px) {

  .review-summary,
  .seat-list {
    grid-template-columns: 1fr;
  }
}
</style>
