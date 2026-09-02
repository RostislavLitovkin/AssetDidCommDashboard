import type { ApiMessage } from "./types";

/** Bucket category that switches a bucket into realXhub marketplace mode. */
export const REALXHUB_CATEGORY = "realXhub";

/** Message tags used by the realXhub marketplace layer. */
export const REALXHUB_OFFER_TAG = "realXhub/offer";
export const REALXHUB_COUNTER_OFFER_TAG = "realXhub/counterOffer";
export const REALXHUB_REFUSE_COUNTER_OFFER_TAG = "realXhub/refuseCounterOffer";
export const REALXHUB_STATUS_TAG = "realXhub/status";

/** All tags that carry marketplace state for a bucket. */
export const REALXHUB_TAGS: readonly string[] = [
  REALXHUB_OFFER_TAG,
  REALXHUB_COUNTER_OFFER_TAG,
  REALXHUB_REFUSE_COUNTER_OFFER_TAG,
  REALXHUB_STATUS_TAG,
];

/** Tags that change the active-offer state machine (status messages excluded). */
export const REALXHUB_MARKET_TAGS: readonly string[] = [
  REALXHUB_OFFER_TAG,
  REALXHUB_COUNTER_OFFER_TAG,
  REALXHUB_REFUSE_COUNTER_OFFER_TAG,
];

/** Case-insensitive category match so "RealXhub" / " REALXHUB " still activate the mode. */
export function isRealXhubCategory(category: string | null | undefined): boolean {
  return typeof category === "string" && category.trim().toLowerCase() === REALXHUB_CATEGORY.toLowerCase();
}

/** Supported Solana clusters. Polkadot networks are intentionally not supported. */
export type SolanaCluster = "solana-devnet" | "solana-mainnet";

export interface SolanaToken {
  cluster: SolanaCluster;
  mint: string;
  symbol: string;
  decimals: number;
}

/** The whitelisted Solana tokens an offer may be priced in. */
export const SOLANA_TOKENS: readonly SolanaToken[] = [
  {
    cluster: "solana-devnet",
    mint: "8umv4NXybZFGiT3tQb1DqJ6DXxLa3rLNhPbcqbQsjXxW",
    symbol: "tUSDC",
    decimals: 6,
  },
  {
    cluster: "solana-devnet",
    mint: "8dW943dozaNPdRRaW6xpV2vxFv1Kcpz3z63Nji3VLups",
    symbol: "XCAV",
    decimals: 9,
  },
  {
    cluster: "solana-devnet",
    mint: "71G3dc4B9p9QBosLx3XhWY3ULRPAxjopngsin66M9HUb",
    symbol: "tGBP",
    decimals: 9,
  },
];

/** Default token for new offers: tGBP on Solana Devnet. */
export const DEFAULT_OFFER_TOKEN: SolanaToken = {
  cluster: "solana-devnet",
  mint: "71G3dc4B9p9QBosLx3XhWY3ULRPAxjopngsin66M9HUb",
  symbol: "tGBP",
  decimals: 9,
};

export function tokenClusterLabel(cluster: SolanaCluster): string {
  return cluster === "solana-mainnet" ? "Solana Mainnet" : "Solana Devnet";
}

export interface MarketPayload {
  kind: "offer" | "counterOffer" | "refuse";
  /** Human-unit decimal price string, e.g. "10.5" for 10.5 tokens. */
  price?: string;
  token?: SolanaToken;
  /** Offer id (ApiMessage.messageId) this counter-offer responds to. */
  counterOf?: string;
  /** Counter-offer id (ApiMessage.messageId) this refusal targets. */
  refusedOf?: string;
}

const MARKET_KINDS: readonly string[] = ["offer", "counterOffer", "refuse"];
const PRICE_PATTERN = /^(\d+)(?:\.(\d+))?$/;

export function isValidPrice(value: string): boolean {
  return PRICE_PATTERN.test(value.trim());
}

/** Encodes a market payload as the message body (JWE-encrypted upstream). */
export function buildMarketPayload(payload: MarketPayload): string {
  return JSON.stringify(payload);
}

/** Decodes and strictly validates a market payload; returns undefined when unreadable. */
export function parseMarketPayload(body: string | null | undefined): MarketPayload | undefined {
  if (typeof body !== "string" || body.trim() === "") {
    return undefined;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return undefined;
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }

  const candidate = raw as Record<string, unknown>;
  const kind = candidate.kind;
  if (typeof kind !== "string" || !MARKET_KINDS.includes(kind)) {
    return undefined;
  }

  const payload: MarketPayload = { kind: kind as MarketPayload["kind"] };

  if (typeof candidate.price === "string" && isValidPrice(candidate.price)) {
    payload.price = candidate.price.trim();
  }

  const token = parseSolanaToken(candidate.token);
  if (token) {
    payload.token = token;
  }

  if (typeof candidate.counterOf === "string" && candidate.counterOf !== "") {
    payload.counterOf = candidate.counterOf;
  }

  if (typeof candidate.refusedOf === "string" && candidate.refusedOf !== "") {
    payload.refusedOf = candidate.refusedOf;
  }

  // Offers and counter-offers are incomplete without a usable price and token.
  if ((kind === "offer" || kind === "counterOffer") && (!payload.price || !payload.token)) {
    return undefined;
  }

  return payload;
}

export function parseSolanaToken(raw: unknown): SolanaToken | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }

  const candidate = raw as Record<string, unknown>;
  if (candidate.cluster !== "solana-devnet" && candidate.cluster !== "solana-mainnet") {
    return undefined;
  }
  if (typeof candidate.mint !== "string" || candidate.mint === "") {
    return undefined;
  }
  if (typeof candidate.symbol !== "string" || candidate.symbol === "") {
    return undefined;
  }
  if (typeof candidate.decimals !== "number" || !Number.isInteger(candidate.decimals) || candidate.decimals < 0) {
    return undefined;
  }

  return {
    cluster: candidate.cluster,
    mint: candidate.mint,
    symbol: candidate.symbol,
    decimals: candidate.decimals,
  };
}

export type MarketStatus = "seller" | "buyer";

export interface StatusPayload {
  address: string;
  status: MarketStatus;
}

/** Encodes a member status payload as the message body. */
export function buildStatusPayload(payload: StatusPayload): string {
  return JSON.stringify(payload);
}

/** Decodes and strictly validates a status payload; returns undefined when unreadable. */
export function parseStatusPayload(body: string | null | undefined): StatusPayload | undefined {
  if (typeof body !== "string" || body.trim() === "") {
    return undefined;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return undefined;
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }

  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.address !== "string" || candidate.address.trim() === "") {
    return undefined;
  }
  if (candidate.status !== "seller" && candidate.status !== "buyer") {
    return undefined;
  }

  return { address: candidate.address.trim(), status: candidate.status };
}

/** Default status per role: admins are sellers, everyone else is a buyer. */
export function defaultStatusForRole(role: string | null | undefined): MarketStatus {
  return role === "admin" ? "seller" : "buyer";
}

/**
 * Resolves the market status for an address. Later entries win, so pass the
 * status payloads in message order (oldest first).
 */
export function resolveMarketStatus(
  address: string,
  role: string | null | undefined,
  orderedStatuses: readonly StatusPayload[],
): MarketStatus {
  const normalized = address.toLowerCase();
  let found: MarketStatus | undefined;

  for (const entry of orderedStatuses) {
    if (entry.address.toLowerCase() === normalized) {
      found = entry.status;
    }
  }

  return found ?? defaultStatusForRole(role);
}

/** A decoded market message paired with the ApiMessage it belongs to. */
export interface MarketMessageEntry {
  message: ApiMessage;
  payload: MarketPayload;
}

export type ActiveMarketOffer =
  | { type: "offer"; message: ApiMessage; payload: MarketPayload }
  | { type: "counterOffer"; message: ApiMessage; payload: MarketPayload };

function marketSortValue(message: ApiMessage): [number, number] {
  const time = Date.parse(message.createdAt);
  const id = Number(message.messageId);
  return [Number.isNaN(time) ? 0 : time, Number.isFinite(id) ? id : 0];
}

function marketSortComparator(a: ApiMessage, b: ApiMessage): number {
  const keyA = marketSortValue(a);
  const keyB = marketSortValue(b);
  return keyA[0] - keyB[0] || keyA[1] - keyB[1];
}

/**
 * Reduces the decoded market messages to the single active offer.
 * The newest message wins: an offer/counter-offer becomes active, a refusal
 * clears the active state. Only the newest offer is ever active; all older
 * ones are superseded. Unreadable payloads are ignored.
 */
export function deriveActiveOffer(entries: readonly MarketMessageEntry[]): ActiveMarketOffer | null {
  let active: ActiveMarketOffer | null = null;

  for (const { message, payload } of [...entries].sort((a, b) => marketSortComparator(a.message, b.message))) {
    if (payload.kind === "refuse") {
      active = null;
      continue;
    }
    active = { type: payload.kind, message, payload };
  }

  return active;
}

/** Normalizes a decimal price for display: strips trailing zeros ("10.50" -> "10.5"). */
export function formatPriceAmount(price: string): string {
  const match = PRICE_PATTERN.exec(price.trim());
  if (!match) {
    return price.trim();
  }

  const integerPart = match[1]!; // group 1 (\d+) always matches
  const fractionPart = match[2]?.replace(/0+$/, "") ?? "";
  return fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
}

/**
 * Converts a human-unit decimal price to raw token units (BigInt), avoiding
 * floating point drift. Returns undefined for malformed input or when the
 * fraction has more digits than the token supports.
 */
export function priceToRawUnits(price: string, decimals: number): bigint | undefined {
  const match = PRICE_PATTERN.exec(price.trim());
  if (!match || !Number.isInteger(decimals) || decimals < 0) {
    return undefined;
  }

  const integerPart = match[1]!; // group 1 (\d+) always matches
  const fractionPart = match[2] ?? "";
  if (fractionPart.length > decimals) {
    return undefined;
  }

  return (
    BigInt(integerPart) * 10n ** BigInt(decimals) +
    (fractionPart ? BigInt(fractionPart.padEnd(decimals, "0")) : 0n)
  );
}

/** Human label for a market payload kind, used on chat cards and bars. */
export function marketKindLabel(kind: MarketPayload["kind"]): string {
  if (kind === "counterOffer") {
    return "Counter-offer";
  }
  return kind === "offer" ? "Offer" : "Refusal";
}

/** Readable one-line summary for a market payload, e.g. "Offer: 10.5 tGBP". */
export function marketPayloadSummary(payload: MarketPayload): string {
  if (payload.kind === "refuse" || !payload.price || !payload.token) {
    return `Counter-offer refused`;
  }

  const label = payload.kind === "counterOffer" ? "Counter-offer" : "Offer";
  return `${label}: ${formatPriceAmount(payload.price)} ${payload.token.symbol}`;
}

const realXhubTagSet: ReadonlySet<string> = new Set(REALXHUB_TAGS);

/** Type-safe check for any realXhub market/status tag. */
export function isRealXhubTag(tag: string | null | undefined): boolean {
  return tag !== null && tag !== undefined && realXhubTagSet.has(tag);
}
