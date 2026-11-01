import type { LawyerReviewBucketMetadata, SolanaCluster } from "./types";

export const LAWYER_REVIEW_BUCKET_CATEGORY = "lawyer-document-review";

interface ReviewBucketInput {
  category: string | null;
  properties: string | null | undefined;
}

function unwrapPropertyValue(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith('"')) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function parseProperties(properties: string | null | undefined): Record<string, unknown> | undefined {
  if (typeof properties !== "string" || !properties.trim()) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(properties);
  } catch {
    return undefined;
  }

  const collected: Record<string, unknown> = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) collected[key] = unwrapPropertyValue(value);
  } else if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      const key = typeof record.key === "string" ? record.key.trim() : "";
      if (key) collected[key] = unwrapPropertyValue(record.value);
    }
  } else {
    return undefined;
  }
  return collected;
}

function decimalId(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return undefined;
  return BigInt(value.trim()).toString();
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseLawyerReviewBucket(
  bucket: ReviewBucketInput,
  options: { legacyCluster?: "devnet" } = {},
): LawyerReviewBucketMetadata | undefined {
  if (bucket.category?.trim() !== LAWYER_REVIEW_BUCKET_CATEGORY) return undefined;
  const properties = parseProperties(bucket.properties);
  if (!properties) return undefined;

  const propertyId = decimalId(properties.property_id);
  const legacyListingId = decimalId(properties.listing_id);
  const selectedId = propertyId ?? legacyListingId;
  if (!selectedId || (propertyId && legacyListingId && propertyId !== legacyListingId)) return undefined;

  const rawCluster = nonEmptyString(properties.cluster);
  const cluster = (rawCluster ?? options.legacyCluster) as SolanaCluster | undefined;
  if (cluster !== "devnet" && cluster !== "mainnet") return undefined;

  const spvLawyer = nonEmptyString(properties.spv_lawyer);
  const developerLawyer = nonEmptyString(properties.developer_lawyer);
  if (!spvLawyer || !developerLawyer) return undefined;

  const listingPda = nonEmptyString(properties.listing);
  const propertyPda = nonEmptyString(properties.property);
  return {
    propertyId: selectedId,
    cluster,
    spvLawyer,
    developerLawyer,
    ...(listingPda ? { listingPda } : {}),
    ...(propertyPda ? { propertyPda } : {}),
  };
}
