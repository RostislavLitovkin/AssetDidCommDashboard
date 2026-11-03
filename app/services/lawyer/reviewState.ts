import { addressesEqual } from "../wallet/addressUtils";
import {
  fetchIndexerLegalReview,
  type IndexerLegalClientOptions,
  type IndexerLegalListing,
} from "./indexerLegalClient";
import type {
  ExecuteDealEvidence,
  LawyerReviewBucketMetadata,
  LawyerReviewState,
  LawyerReviewTallies,
} from "./types";

function normalizeHash(hash: string): string {
  const trimmed = hash.trim().toLowerCase();
  return trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
}

export function deriveLawyerReviewState(
  listing: IndexerLegalListing,
  bucket: LawyerReviewBucketMetadata,
  settlement: ExecuteDealEvidence | null,
): LawyerReviewState {
  const verdicts = [listing.spvVerdict, listing.developerVerdict];
  const counts: LawyerReviewTallies = {
    approved: verdicts.filter((verdict) => verdict === "approved").length,
    rejected: verdicts.filter((verdict) => verdict === "rejected").length,
    pending: verdicts.filter((verdict) => verdict === "pending").length,
  };
  const percentages: LawyerReviewTallies = {
    approved: counts.approved * 50,
    rejected: counts.rejected * 50,
    pending: counts.pending * 50,
  };
  const staleAssignment =
    !addressesEqual(listing.spvLawyer, bucket.spvLawyer) ||
    !addressesEqual(listing.developerLawyer, bucket.developerLawyer);
  const bothDecided = listing.spvVerdict !== "pending" && listing.developerVerdict !== "pending";
  const bothApproved = listing.spvVerdict === "approved" && listing.developerVerdict === "approved";
  const hashMismatch = bothDecided &&
    normalizeHash(listing.spvDocumentsHash) !== normalizeHash(listing.developerDocumentsHash);
  const settlementSeatsMatch = settlement !== null &&
    addressesEqual(settlement.spvLawyer, listing.spvLawyer) &&
    addressesEqual(settlement.developerLawyer, listing.developerLawyer);

  return {
    listingId: listing.listingId,
    assetId: listing.assetId,
    spv: {
      role: "spv",
      wallet: listing.spvLawyer,
      verdict: listing.spvVerdict,
      documentsHash: listing.spvDocumentsHash,
    },
    developer: {
      role: "developer",
      wallet: listing.developerLawyer,
      verdict: listing.developerVerdict,
      documentsHash: listing.developerDocumentsHash,
    },
    attempt: listing.secondAttempt ? 2 : 1,
    status: listing.status,
    legalDeadline: listing.legalDeadline,
    counts,
    percentages,
    staleAssignment,
    hashMismatch,
    settlementReady: listing.status === "LEGAL" && bothApproved && settlementSeatsMatch && !staleAssignment && !hashMismatch,
    settlement,
  };
}

export async function loadLawyerReviewState(
  bucket: LawyerReviewBucketMetadata,
  options: IndexerLegalClientOptions = {},
): Promise<LawyerReviewState | null> {
  const review = await fetchIndexerLegalReview(bucket, options);
  return review ? deriveLawyerReviewState(review.listing, bucket, review.settlement) : null;
}
