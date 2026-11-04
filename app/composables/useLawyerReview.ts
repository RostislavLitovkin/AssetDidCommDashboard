import { Connection } from "@solana/web3.js";
import { computed, getCurrentScope, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import type { ApiMessage } from "../services/buckets/types";
import { addressesEqual } from "../services/wallet/addressUtils";
import { getLegalClusterConfig } from "../services/lawyer/cluster";
import {
  computeDocumentSetHash,
  selectCurrentLawyerDocuments,
  selectLawyerDocumentRevisionCandidates,
  type CurrentLawyerDocuments,
} from "../services/lawyer/documentSet";
import type { IndexerLegalClientOptions } from "../services/lawyer/indexerLegalClient";
import { parseLawyerReviewBucket } from "../services/lawyer/reviewBucket";
import { loadLawyerReviewState } from "../services/lawyer/reviewState";
import {
  prepareExecuteDealTransactions,
  submitLawyerConfirmDocuments,
  submitPreparedLegalTransactions,
  type LegalSubmissionOptions,
} from "../services/lawyer/solanaLegal";
import type {
  LawyerReviewBucketMetadata,
  LawyerReviewState,
  LawyerSeatRole,
} from "../services/lawyer/types";

export interface HydratedLawyerAttachment {
  data: string;
  contentType?: string;
  fileName?: string;
}

export interface LawyerDocumentSource {
  message: ApiMessage;
  reference: string | null;
  attachment: HydratedLawyerAttachment | null;
}

export type LawyerDocumentLoader = (source: LawyerDocumentSource) => Promise<Uint8Array>;

export interface LawyerReviewInput {
  bucket: { category: string | null; properties: string | null | undefined } | null;
  messages: readonly ApiMessage[];
  walletAddress?: string | null;
  hydratedAttachments?: Readonly<Record<string, HydratedLawyerAttachment | undefined>>;
}

export interface UseLawyerReviewOptions {
  loadDocument: LawyerDocumentLoader;
  indexer?: IndexerLegalClientOptions;
  submission?: LegalSubmissionOptions;
  legacyCluster?: "devnet";
  now?: () => number;
}

export interface LawyerSubmissionResult {
  signature: string;
  walletName: string;
}

export interface UseLawyerReview {
  metadata: Ref<LawyerReviewBucketMetadata | null>;
  state: Ref<LawyerReviewState | null>;
  documents: Ref<CurrentLawyerDocuments>;
  documentSetHash: Ref<`0x${string}` | null>;
  loading: Ref<boolean>;
  submitting: Ref<boolean>;
  executing: Ref<boolean>;
  error: Ref<string>;
  documentError: Ref<string>;
  statusMessage: Ref<string>;
  lawyerRole: ComputedRef<LawyerSeatRole | null>;
  canSubmit: ComputedRef<boolean>;
  canExecute: ComputedRef<boolean>;
  refresh: (input: LawyerReviewInput) => Promise<void>;
  submitVerdict: (approve: boolean) => Promise<LawyerSubmissionResult | null>;
  executeDeal: () => Promise<LawyerSubmissionResult[] | null>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function decodeDocumentsHash(hash: `0x${string}`): Uint8Array {
  const bytes = new Uint8Array(hash.slice(2).length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hash.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return bytes;
}

function hashesEqual(left: string, right: string): boolean {
  const normalize = (hash: string) => hash.trim().toLowerCase().replace(/^0x/, "");
  return normalize(left) === normalize(right);
}

export function useLawyerReview(options: UseLawyerReviewOptions): UseLawyerReview {
  const metadata = ref<LawyerReviewBucketMetadata | null>(null);
  const state = ref<LawyerReviewState | null>(null);
  const documents = ref<CurrentLawyerDocuments>({ spv: null, developer: null });
  const documentSetHash = ref<`0x${string}` | null>(null);
  const loading = ref(false);
  const submitting = ref(false);
  const executing = ref(false);
  const error = ref("");
  const documentError = ref("");
  const statusMessage = ref("");
  let currentInput: LawyerReviewInput | null = null;
  const now = options.now ?? Date.now;
  const clock = ref(now());
  if (getCurrentScope()) {
    const timer = setInterval(() => {
      clock.value = now();
    }, 1000);
    onScopeDispose(() => clearInterval(timer));
  }
  const confirmedSubmissions: Array<{
    cluster: string;
    listingId: string;
    attempt: 1 | 2;
    wallet: string;
  }> = [];

  function hasUnobservedSubmission(review: LawyerReviewState, wallet: string): boolean {
    return confirmedSubmissions.some((submission) =>
      submission.cluster === metadata.value?.cluster
      && submission.listingId === review.listingId
      && submission.attempt === review.attempt
      && addressesEqual(submission.wallet, wallet)
    );
  }

  function deadlineOpenAt(review: LawyerReviewState, timestamp: number): boolean {
    return Math.floor(timestamp / 1000) <= review.legalDeadline;
  }

  function deadlineOpen(review: LawyerReviewState): boolean {
    return deadlineOpenAt(review, now()) && deadlineOpenAt(review, clock.value);
  }

  function legalProcessExpired(): null {
    error.value = "LEGAL_PROCESS_EXPIRED";
    statusMessage.value = "LEGAL_PROCESS_EXPIRED";
    return null;
  }

  const lawyerRole = computed<LawyerSeatRole | null>(() => {
    const review = state.value;
    const wallet = currentInput?.walletAddress?.trim();
    if (!review || review.staleAssignment || !wallet) return null;
    if (addressesEqual(wallet, review.spv.wallet)) return "spv";
    if (addressesEqual(wallet, review.developer.wallet)) return "developer";
    return null;
  });
  const canSubmit = computed(() => {
    const role = lawyerRole.value;
    const review = state.value;
    const hash = documentSetHash.value;
    const wallet = currentInput?.walletAddress?.trim();
    if (!role || !review || !hash || !wallet) return false;
    const other = role === "spv" ? review.developer : review.spv;
    return review[role].verdict === "pending"
      && (other.verdict === "pending" || hashesEqual(other.documentsHash, hash))
      && review.status === "SOLD_OUT"
      && !review.hashMismatch
      && deadlineOpen(review)
      && !hasUnobservedSubmission(review, wallet)
      && !loading.value
      && !submitting.value
      && !executing.value;
  });
  const canExecute = computed(() => Boolean(
    currentInput?.walletAddress?.trim()
    && state.value?.settlementReady
    && deadlineOpen(state.value)
    && !loading.value
    && !submitting.value
    && !executing.value
  ));

  let refreshGeneration = 0;

  async function refresh(input: LawyerReviewInput): Promise<void> {
    const generation = ++refreshGeneration;
    currentInput = input;
    loading.value = true;
    error.value = "";
    documentError.value = "";
    statusMessage.value = "Loading lawyer review…";

    try {
      const parsed = parseLawyerReviewBucket(input.bucket ?? { category: null, properties: null }, {
        legacyCluster: options.legacyCluster,
      });
      if (!parsed) {
        metadata.value = null;
        state.value = null;
        documents.value = { spv: null, developer: null };
        documentSetHash.value = null;
        error.value = "This is not a valid lawyer review bucket.";
        statusMessage.value = error.value;
        return;
      }
      metadata.value = parsed;

      let review: LawyerReviewState | null;
      try {
        review = await loadLawyerReviewState(parsed, options.indexer);
      } catch (cause) {
        if (generation !== refreshGeneration) return;
        state.value = null;
        documents.value = { spv: null, developer: null };
        documentSetHash.value = null;
        error.value = errorMessage(cause, "Failed to load lawyer review state.");
        statusMessage.value = error.value;
        return;
      }
      if (generation !== refreshGeneration) return;
      if (!review) {
        state.value = null;
        documents.value = { spv: null, developer: null };
        documentSetHash.value = null;
        error.value = "No active listing was found for this review bucket.";
        statusMessage.value = error.value;
        return;
      }
      state.value = review;

      const seats = {
        spvLawyer: review.spv.wallet,
        developerLawyer: review.developer.wallet,
      };
      let selected = selectCurrentLawyerDocuments(input.messages, seats);
      documents.value = selected;
      if (!selected.spv || !selected.developer) {
        documentSetHash.value = null;
        documentError.value = "Both current lawyer PDF documents are required.";
        statusMessage.value = documentError.value;
        return;
      }

      try {
        const candidates = selectLawyerDocumentRevisionCandidates(input.messages, seats);
        const decidedSeats = [review.spv, review.developer].filter((seat) => seat.verdict !== "pending");
        const byteCache = new Map<string, Promise<Uint8Array>>();
        const load = (message: ApiMessage): Promise<Uint8Array> => {
          const cached = byteCache.get(message.id);
          if (cached) return cached;
          const bytes = options.loadDocument({
            message,
            reference: message.reference,
            attachment: input.hydratedAttachments?.[message.id] ?? null,
          });
          byteCache.set(message.id, bytes);
          return bytes;
        };
        const hashPair = async (spv: ApiMessage, developer: ApiMessage) => {
          const [spvBytes, developerBytes] = await Promise.all([load(spv), load(developer)]);
          return computeDocumentSetHash(spvBytes, developerBytes);
        };

        let hash: `0x${string}` | null = null;
        if (decidedSeats.length === 0) {
          hash = await hashPair(selected.spv, selected.developer);
        } else {
          for (const spv of candidates.spv) {
            for (const developer of candidates.developer) {
              const candidateHash = await hashPair(spv, developer);
              if (!decidedSeats.every((seat) => hashesEqual(seat.documentsHash, candidateHash))) continue;
              selected = { spv, developer };
              hash = candidateHash;
              break;
            }
            if (hash) break;
          }
          if (!hash) {
            throw new Error(
              "The recorded lawyer decision does not match any available PDF revision set. Restore the original PDFs before submitting another verdict.",
            );
          }
        }
        if (generation !== refreshGeneration) return;
        documents.value = selected;
        documentSetHash.value = hash;
        statusMessage.value = "";
      } catch (cause) {
        if (generation !== refreshGeneration) return;
        documentSetHash.value = null;
        documentError.value = errorMessage(cause, "Failed to load lawyer PDF documents.");
        statusMessage.value = documentError.value;
      }
    } finally {
      if (generation === refreshGeneration) loading.value = false;
    }
  }

  async function submitVerdict(approve: boolean): Promise<LawyerSubmissionResult | null> {
    if (state.value && !deadlineOpenAt(state.value, now())) return legalProcessExpired();
    if (!canSubmit.value || !currentInput || !metadata.value || !state.value || !documentSetHash.value) return null;
    const input = currentInput;
    const bucket = metadata.value;
    const review = state.value;
    const hash = documentSetHash.value;
    const lawyer = input.walletAddress!;
    submitting.value = true;
    error.value = "";
    statusMessage.value = "Submitting lawyer decision…";

    try {
      const config = getLegalClusterConfig(bucket.cluster, options.indexer);
      const result = await submitLawyerConfirmDocuments({
        config,
        listingId: bucket.propertyId,
        lawyer,
        assignedLawyers: [review.spv.wallet, review.developer.wallet],
        approve,
        documentsHash: decodeDocumentsHash(hash),
      }, options.submission);
      confirmedSubmissions.push({
        cluster: bucket.cluster,
        listingId: review.listingId,
        attempt: review.attempt,
        wallet: lawyer,
      });
      statusMessage.value = "Lawyer decision submitted. Refreshing review…";
      await refresh(currentInput ?? input);
      statusMessage.value = error.value || documentError.value
        ? "Lawyer decision submitted, but the review could not be refreshed."
        : "Lawyer decision submitted.";
      return result;
    } catch (cause) {
      error.value = errorMessage(cause, "Failed to submit lawyer decision.");
      statusMessage.value = error.value;
      return null;
    } finally {
      submitting.value = false;
    }
  }

  async function executeDeal(): Promise<LawyerSubmissionResult[] | null> {
    if (state.value && !deadlineOpenAt(state.value, now())) return legalProcessExpired();
    if (!canExecute.value || !currentInput || !metadata.value || !state.value?.settlement) return null;
    const input = currentInput;
    const bucket = metadata.value;
    const review = state.value;
    const settlement = review.settlement!;
    const payer = input.walletAddress!;
    executing.value = true;
    error.value = "";
    statusMessage.value = "Preparing deal execution…";

    try {
      const config = getLegalClusterConfig(bucket.cluster, options.indexer);
      const connection = options.submission?.connection ?? new Connection(config.rpcUrl, "confirmed");
      const prepared = await prepareExecuteDealTransactions({
        config,
        payer,
        listingId: bucket.propertyId,
        regionId: settlement.regionId,
        developer: settlement.developer,
        developerLawyer: settlement.developerLawyer,
        spvLawyer: settlement.spvLawyer,
        collectedMints: settlement.collectedMints,
      }, { connection });
      statusMessage.value = "Submitting deal execution…";
      const result = await submitPreparedLegalTransactions(prepared, payer, config, {
        ...options.submission,
        connection,
      });
      statusMessage.value = "Deal executed. Refreshing review…";
      await refresh(currentInput ?? input);
      statusMessage.value = error.value || documentError.value
        ? "Deal executed, but the review could not be refreshed."
        : "Deal executed.";
      return result;
    } catch (cause) {
      error.value = errorMessage(cause, "Failed to execute deal.");
      statusMessage.value = error.value;
      return null;
    } finally {
      executing.value = false;
    }
  }

  return {
    metadata,
    state,
    documents,
    documentSetHash,
    loading,
    submitting,
    executing,
    error,
    documentError,
    statusMessage,
    lawyerRole,
    canSubmit,
    canExecute,
    refresh,
    submitVerdict,
    executeDeal,
  };
}
