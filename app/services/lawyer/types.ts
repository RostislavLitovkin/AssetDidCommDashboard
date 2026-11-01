export type SolanaCluster = "devnet" | "mainnet";

export interface LawyerReviewBucketMetadata {
  propertyId: string;
  cluster: SolanaCluster;
  spvLawyer: string;
  developerLawyer: string;
  listingPda?: string;
  propertyPda?: string;
}

export type LawyerSeatRole = "spv" | "developer";
export type LawyerVerdict = "pending" | "approved" | "rejected";
export type LawyerListingStatus =
  | "PENDING_ASSETS"
  | "LISTED"
  | "SOLD_OUT"
  | "LEGAL"
  | "FINALIZED"
  | "EXPIRED"
  | "CANCELLED"
  | "REFUNDING";

export interface LawyerSeatState {
  role: LawyerSeatRole;
  wallet: string;
  verdict: LawyerVerdict;
  documentsHash: string;
}

export interface LawyerReviewTallies {
  approved: number;
  rejected: number;
  pending: number;
}

export interface ExecuteDealEvidence {
  regionId: number;
  developer: string;
  developerLawyer: string;
  spvLawyer: string;
  xcavMint: string;
  treasury: string;
  acceptedPaymentMints: string[];
  collectedMints: string[];
}

export interface LawyerReviewState {
  listingId: string;
  assetId: string;
  spv: LawyerSeatState;
  developer: LawyerSeatState;
  attempt: 1 | 2;
  status: LawyerListingStatus;
  legalDeadline: number;
  counts: LawyerReviewTallies;
  percentages: LawyerReviewTallies;
  staleAssignment: boolean;
  hashMismatch: boolean;
  settlementReady: boolean;
  settlement: ExecuteDealEvidence | null;
}
