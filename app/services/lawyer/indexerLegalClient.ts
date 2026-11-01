import { getLegalClusterConfig, type LegalClusterConfigOptions } from "./cluster";
import type {
  ExecuteDealEvidence,
  LawyerListingStatus,
  LawyerReviewBucketMetadata,
  LawyerVerdict,
} from "./types";

export interface IndexerLegalListing {
  listingId: string;
  assetId: string;
  spvLawyer: string;
  spvVerdict: LawyerVerdict;
  spvDocumentsHash: string;
  developerLawyer: string;
  developerVerdict: LawyerVerdict;
  developerDocumentsHash: string;
  secondAttempt: boolean;
  status: LawyerListingStatus;
  legalDeadline: number;
}

export interface IndexerLegalReview {
  listing: IndexerLegalListing;
  settlement: ExecuteDealEvidence | null;
}

export interface IndexerLegalClientOptions extends LegalClusterConfigOptions {
  endpoint?: string;
  fetcher?: typeof fetch;
}

async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  endpoint: string,
  fetcher: typeof fetch,
): Promise<T> {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Indexer HTTP ${response.status}`);
  const body = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message ?? "GraphQL error").join("; "));
  if (!body.data) throw new Error("Indexer returned no data");
  return body.data;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = asString(record[field]);
  if (!value) throw new Error(`Indexer listing is missing ${field}`);
  return value;
}

function verdict(value: unknown): LawyerVerdict {
  if (value === "PENDING") return "pending";
  if (value === "APPROVED") return "approved";
  if (value === "REJECTED") return "rejected";
  throw new Error(`Indexer returned an unknown lawyer document status: ${String(value)}`);
}

function listingStatus(value: unknown): LawyerListingStatus {
  const statuses: LawyerListingStatus[] = [
    "PENDING_ASSETS", "LISTED", "SOLD_OUT", "LEGAL", "FINALIZED", "EXPIRED", "CANCELLED", "REFUNDING",
  ];
  if (typeof value === "string" && statuses.includes(value as LawyerListingStatus)) return value as LawyerListingStatus;
  throw new Error(`Indexer returned an unknown listing status: ${String(value)}`);
}

function parseListing(value: unknown): IndexerLegalListing | null {
  const connection = asRecord(value);
  const node = Array.isArray(connection?.nodes) ? asRecord(connection.nodes[0]) : undefined;
  if (!node) return null;
  const legalDeadline = asNumber(node.legalDeadline);
  if (legalDeadline === undefined) throw new Error("Indexer listing is missing legalDeadline");
  return {
    listingId: requiredString(node, "listingId"),
    assetId: requiredString(node, "assetId"),
    spvLawyer: requiredString(node, "spvLawyer"),
    spvVerdict: verdict(node.spvLawyerDocStatus),
    spvDocumentsHash: requiredString(node, "spvLawyerDocumentsHash"),
    developerLawyer: requiredString(node, "developerLawyer"),
    developerVerdict: verdict(node.developerLawyerDocStatus),
    developerDocumentsHash: requiredString(node, "developerLawyerDocumentsHash"),
    secondAttempt: node.secondAttempt === true,
    status: listingStatus(node.status),
    legalDeadline,
  };
}

function parseSettlement(value: unknown): ExecuteDealEvidence | null {
  const pending = asRecord(value);
  if (!pending || pending.executeDeal === null) return null;
  const deal = asRecord(pending.executeDeal);
  if (!deal) throw new Error("Indexer returned malformed executeDeal evidence");
  const regionId = asNumber(deal.regionId);
  const acceptedPaymentMints = Array.isArray(deal.acceptedPaymentMints)
    ? deal.acceptedPaymentMints.map(asString).filter((mint): mint is string => mint !== undefined)
    : [];
  const collectedMints = Array.isArray(deal.collectedMints)
    ? deal.collectedMints.map(asString).filter((mint): mint is string => mint !== undefined)
    : [];
  if (regionId === undefined) throw new Error("Indexer executeDeal evidence is missing regionId");
  return {
    regionId,
    developer: requiredString(deal, "developer"),
    developerLawyer: requiredString(deal, "developerLawyer"),
    spvLawyer: requiredString(deal, "spvLawyer"),
    xcavMint: requiredString(deal, "xcavMint"),
    treasury: requiredString(deal, "treasury"),
    acceptedPaymentMints,
    collectedMints,
  };
}

export async function fetchIndexerLegalReview(
  bucket: LawyerReviewBucketMetadata,
  options: IndexerLegalClientOptions = {},
): Promise<IndexerLegalReview | null> {
  const endpoint = options.endpoint ?? getLegalClusterConfig(bucket.cluster, options).indexerGraphqlUrl;
  const data = await graphql<{ listings: unknown; pendingFinalizations: unknown }>(
    `query LawyerReview($listingId: I64!, $assetId: I64!) {
      listings(listingId: $listingId, active: true, first: 1) {
        nodes {
          listingId assetId
          spvLawyer spvLawyerDocStatus spvLawyerDocumentsHash
          developerLawyer developerLawyerDocStatus developerLawyerDocumentsHash
          secondAttempt status legalDeadline
        }
      }
      pendingFinalizations(assetId: $assetId, listingId: $listingId) {
        executeDeal {
          regionId developer developerLawyer spvLawyer
          xcavMint treasury acceptedPaymentMints collectedMints
        }
      }
    }`,
    { listingId: bucket.propertyId, assetId: bucket.propertyId },
    endpoint,
    options.fetcher ?? fetch,
  );
  const listing = parseListing(data.listings);
  return listing ? { listing, settlement: parseSettlement(data.pendingFinalizations) } : null;
}
