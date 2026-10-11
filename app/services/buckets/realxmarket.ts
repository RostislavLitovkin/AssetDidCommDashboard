import { addressesEqual } from "../wallet/addressUtils";
import type { ApiMessage } from "./types";

/** Bucket category that switches a bucket into realXmarket secondary-market mode. */
export const REALXMARKET_CATEGORY = "realXmarket";

/** Message tags used by the realXmarket offer/negotiation layer. */
export const REALXMARKET_OFFER_TAG = "realXmarket/offer";
export const REALXMARKET_COUNTER_OFFER_TAG = "realXmarket/counterOffer";
export const REALXMARKET_ACCEPT_TAG = "realXmarket/accept";
export const REALXMARKET_REFUSE_TAG = "realXmarket/refuse";
export const REALXMARKET_STATUS_TAG = "realXmarket/status";

/** All tags that carry negotiation state for a realXmarket bucket. */
export const REALXMARKET_TAGS: readonly string[] = [
  REALXMARKET_OFFER_TAG,
  REALXMARKET_COUNTER_OFFER_TAG,
  REALXMARKET_ACCEPT_TAG,
  REALXMARKET_REFUSE_TAG,
  REALXMARKET_STATUS_TAG,
];

/** Protocol version every realXmarket payload is stamped with. */
export const REALXMARKET_PROTOCOL_VERSION = 1;

/** pricePerToken is a fixed-point GBP quote with this many decimals ("123000000000" == £123). */
export const REALXMARKET_PRICE_DECIMALS = 9;

/** Case-insensitive category match so "RealXmarket" / " REALXMARKET " still activate the mode. */
export function isRealXmarketCategory(category: string | null | undefined): boolean {
  return typeof category === "string" && category.trim().toLowerCase() === REALXMARKET_CATEGORY.toLowerCase();
}

const realXmarketTagSet: ReadonlySet<string> = new Set(REALXMARKET_TAGS);

/** Type-safe check for any realXmarket negotiation tag. */
export function isRealXmarketTag(tag: string | null | undefined): boolean {
  return tag !== null && tag !== undefined && realXmarketTagSet.has(tag);
}

export type RealXmarketKind = "offer" | "counterOffer" | "accept" | "refuse" | "status";

const REALXMARKET_KINDS: readonly string[] = ["offer", "counterOffer", "accept", "refuse", "status"];

/** The negotiation payload shared by all realXmarket/* messages (JSON, contentType application/json). */
export interface RealXmarketPayload {
  kind: RealXmarketKind;
  version: number;
  shareListingId: string;
  assetId: string;
  /** 9-decimal fixed-point GBP quote per token, decimal string ("123000000000" == £123). */
  pricePerToken?: string;
  /** Whole-token amount; integer > 0. */
  amount?: number;
  /**
   * Message reference: for a counter-offer the offer it supersedes, for an
   * accept the message being accepted. Carries ApiMessage.messageId (the
   * per-bucket on-chain sequence number as a decimal string); null when empty.
   */
  counterOf?: string | null;
  /** Wallet address of the proposer. */
  from?: string;
  note?: string;
  /** Terminal marker for kind=status ("purchased"); unknown statuses are kept for display. */
  status?: string;
  /** Solana transaction signature, present on purchased status messages. */
  tx?: string;
}

const PRICE_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/** A pricePerToken value is a decimal string whose numeric value is strictly positive. */
export function isValidPricePerToken(value: string): boolean {
  const match = PRICE_PATTERN.exec(value.trim());
  if (!match) return false;
  // Reject zero: every digit of the integer and fraction part must be 0 for the value to be 0.
  return /[1-9]/.test(match[1]! + (match[2] ?? ""));
}

function isValidAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function asIdString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export interface RealXmarketTermsInput {
  shareListingId: string;
  assetId: string;
  pricePerToken: string;
  amount: number;
  from: string;
  note?: string;
}

export interface RealXmarketCounterInput extends RealXmarketTermsInput {
  /** ApiMessage.messageId of the offer being countered. */
  counterOf: string;
}

export interface RealXmarketAcceptInput extends RealXmarketTermsInput {
  /** ApiMessage.messageId of the offer / counter-offer being accepted. */
  counterOf: string;
}

export interface RealXmarketRefuseInput {
  shareListingId: string;
  assetId: string;
  from: string;
  counterOf?: string | null;
  note?: string;
}

export interface RealXmarketStatusInput {
  shareListingId: string;
  assetId: string;
  status: string;
  tx?: string;
  from?: string;
  note?: string;
}

function requireIds(input: { shareListingId: string; assetId: string }): void {
  if (typeof input.shareListingId !== "string" || input.shareListingId.trim() === "") {
    throw new Error("shareListingId is required");
  }
  if (typeof input.assetId !== "string" || input.assetId.trim() === "") {
    throw new Error("assetId is required");
  }
}

function requireTerms(input: RealXmarketTermsInput): void {
  requireIds(input);
  if (!isValidPricePerToken(input.pricePerToken)) {
    throw new Error("pricePerToken must be a positive decimal string");
  }
  if (!isValidAmount(input.amount)) {
    throw new Error("amount must be a positive integer");
  }
  if (typeof input.from !== "string" || input.from.trim() === "") {
    throw new Error("from is required");
  }
}

/** Encodes the opening offer (normally seeded by the app as plaintext; SPA sends it JWE-encrypted). */
export function buildOfferPayload(input: RealXmarketTermsInput): string {
  requireTerms(input);
  return JSON.stringify({
    kind: "offer",
    version: REALXMARKET_PROTOCOL_VERSION,
    shareListingId: input.shareListingId,
    assetId: input.assetId,
    pricePerToken: input.pricePerToken.trim(),
    amount: input.amount,
    counterOf: null,
    from: input.from,
    ...(input.note !== undefined ? { note: input.note } : {}),
  });
}

/** Encodes a counter-offer superseding the offer referenced by counterOf. */
export function buildCounterOfferPayload(input: RealXmarketCounterInput): string {
  requireTerms(input);
  if (typeof input.counterOf !== "string" || input.counterOf.trim() === "") {
    throw new Error("counterOf is required");
  }
  return JSON.stringify({
    kind: "counterOffer",
    version: REALXMARKET_PROTOCOL_VERSION,
    shareListingId: input.shareListingId,
    assetId: input.assetId,
    pricePerToken: input.pricePerToken.trim(),
    amount: input.amount,
    counterOf: input.counterOf,
    from: input.from,
    ...(input.note !== undefined ? { note: input.note } : {}),
  });
}

/** Encodes an acceptance; counterOf carries the id of the accepted message. */
export function buildAcceptPayload(input: RealXmarketAcceptInput): string {
  requireTerms(input);
  if (typeof input.counterOf !== "string" || input.counterOf.trim() === "") {
    throw new Error("counterOf is required");
  }
  return JSON.stringify({
    kind: "accept",
    version: REALXMARKET_PROTOCOL_VERSION,
    shareListingId: input.shareListingId,
    assetId: input.assetId,
    pricePerToken: input.pricePerToken.trim(),
    amount: input.amount,
    counterOf: input.counterOf,
    from: input.from,
    ...(input.note !== undefined ? { note: input.note } : {}),
  });
}

/** Encodes a refusal of the offer currently on the table. */
export function buildRefusePayload(input: RealXmarketRefuseInput): string {
  requireIds(input);
  if (typeof input.from !== "string" || input.from.trim() === "") {
    throw new Error("from is required");
  }
  return JSON.stringify({
    kind: "refuse",
    version: REALXMARKET_PROTOCOL_VERSION,
    shareListingId: input.shareListingId,
    assetId: input.assetId,
    counterOf: input.counterOf ?? null,
    from: input.from,
    ...(input.note !== undefined ? { note: input.note } : {}),
  });
}

/** Encodes a status message ("purchased" closes the negotiation; may carry tx). */
export function buildStatusPayload(input: RealXmarketStatusInput): string {
  requireIds(input);
  if (typeof input.status !== "string" || input.status.trim() === "") {
    throw new Error("status is required");
  }
  return JSON.stringify({
    kind: "status",
    version: REALXMARKET_PROTOCOL_VERSION,
    shareListingId: input.shareListingId,
    assetId: input.assetId,
    counterOf: null,
    ...(input.from !== undefined ? { from: input.from } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
    status: input.status,
    ...(input.tx !== undefined ? { tx: input.tx } : {}),
  });
}

/**
 * Decodes and strictly validates a realXmarket payload; returns undefined when
 * unreadable. Plaintext-tolerant: accepts a JSON string or an already-decoded
 * object (the app seeds the first offer and the key-sharing message as raw
 * JSON, so those arrive pre-parsed on some paths).
 */
export function parseRealXmarketPayload(body: unknown): RealXmarketPayload | undefined {
  let raw: unknown = body;
  if (typeof raw === "string") {
    if (raw.trim() === "") return undefined;
    try {
      raw = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }

  const candidate = raw as Record<string, unknown>;
  const kind = candidate.kind;
  if (typeof kind !== "string" || !REALXMARKET_KINDS.includes(kind)) {
    return undefined;
  }
  if (candidate.version !== REALXMARKET_PROTOCOL_VERSION) {
    return undefined;
  }

  const shareListingId = asIdString(candidate.shareListingId);
  const assetId = asIdString(candidate.assetId);
  if (!shareListingId || !assetId) {
    return undefined;
  }

  const payload: RealXmarketPayload = {
    kind: kind as RealXmarketKind,
    version: REALXMARKET_PROTOCOL_VERSION,
    shareListingId,
    assetId,
  };

  if (typeof candidate.pricePerToken === "string" || typeof candidate.pricePerToken === "number") {
    const price = String(candidate.pricePerToken).trim();
    if (!isValidPricePerToken(price)) return undefined;
    payload.pricePerToken = price;
  }
  if (candidate.amount !== undefined) {
    if (!isValidAmount(candidate.amount)) return undefined;
    payload.amount = candidate.amount;
  }

  // Offers and counter-offers are incomplete without usable terms.
  if ((kind === "offer" || kind === "counterOffer") && (!payload.pricePerToken || payload.amount === undefined)) {
    return undefined;
  }

  if (typeof candidate.counterOf === "string" && candidate.counterOf.trim() !== "") {
    payload.counterOf = candidate.counterOf.trim();
  } else if (candidate.counterOf === null) {
    payload.counterOf = null;
  }

  const from = asOptionalString(candidate.from);
  if (from) payload.from = from;
  if (typeof candidate.note === "string") payload.note = candidate.note;

  if (kind === "status") {
    const status = asOptionalString(candidate.status);
    if (!status) return undefined;
    payload.status = status;
    const tx = asOptionalString(candidate.tx);
    if (tx) payload.tx = tx;
  }

  return payload;
}

/** A decoded realXmarket message paired with the ApiMessage it belongs to. */
export interface RealXmarketEntry {
  message: ApiMessage;
  payload: RealXmarketPayload;
}

export type NegotiationParty = "buyer" | "seller";

export interface RealXmarketParties {
  buyer?: string;
  seller?: string;
}

export interface RealXmarketAgreement {
  pricePerToken: string;
  amount: number;
  /** ApiMessage.messageId the accept referenced, when it carried one. */
  acceptedMessageId: string | null;
  /** The accept message itself. */
  entry: RealXmarketEntry;
}

export interface RealXmarketNegotiation {
  /** The offer / counter-offer currently on the table (newest supersedes older). */
  latestOffer: RealXmarketEntry | null;
  /** The party that must respond next; null when no response is expected. */
  awaitingParty: NegotiationParty | null;
  /** Set by an accept; terms come from the accepted message, falling back to the accept itself. */
  agreed: RealXmarketAgreement | null;
  /** The refusal that cleared the table, when one happened. */
  refused: RealXmarketEntry | null;
  /** Terminal: a status message with status "purchased". Everything after it is ignored. */
  purchased: RealXmarketEntry | null;
}

function sortValue(message: ApiMessage): [number, number] {
  const time = Date.parse(message.createdAt);
  const id = Number(message.messageId);
  return [Number.isNaN(time) ? 0 : time, Number.isFinite(id) ? id : 0];
}

function sortComparator(a: ApiMessage, b: ApiMessage): number {
  const keyA = sortValue(a);
  const keyB = sortValue(b);
  return keyA[0] - keyB[0] || keyA[1] - keyB[1];
}

function flip(party: NegotiationParty): NegotiationParty {
  return party === "buyer" ? "seller" : "buyer";
}

function partyOfAddress(address: string | undefined, parties: RealXmarketParties): NegotiationParty | null {
  if (!address) return null;
  if (parties.buyer && addressesEqual(address, parties.buyer)) return "buyer";
  if (parties.seller && addressesEqual(address, parties.seller)) return "seller";
  return null;
}

function proposerOf(entry: RealXmarketEntry): string | undefined {
  return entry.payload.from ?? entry.message.contributor ?? undefined;
}

/**
 * Reduces the decoded realXmarket messages to the negotiation state.
 * Newest-wins: a counter-offer supersedes its counterOf ancestor (and every
 * older offer), an accept closes the negotiation with the terms of the
 * message it references, a refusal clears the table, and a purchased status
 * is terminal. Offers arriving after an accept do not reopen a closed deal;
 * a fresh offer after a refusal starts a new round. Unreadable payloads are
 * ignored by the caller (entries arrive pre-parsed).
 */
export function deriveRealXmarketNegotiation(
  entries: readonly RealXmarketEntry[],
  parties: RealXmarketParties = {},
): RealXmarketNegotiation {
  const sorted = [...entries].sort((a, b) => sortComparator(a.message, b.message));

  // Look up referenced messages by either identifier: the on-chain messageId
  // (what this app writes into counterOf) or the API row id.
  const byReference = new Map<string, RealXmarketEntry>();
  for (const entry of sorted) {
    byReference.set(entry.message.messageId, entry);
    byReference.set(entry.message.id, entry);
  }

  let latestOffer: RealXmarketEntry | null = null;
  let awaitingParty: NegotiationParty | null = null;
  let agreed: RealXmarketAgreement | null = null;
  let refused: RealXmarketEntry | null = null;
  let purchased: RealXmarketEntry | null = null;
  let lastProposerParty: NegotiationParty | null = null;

  for (const entry of sorted) {
    if (purchased) break; // purchased is terminal
    const { payload } = entry;

    switch (payload.kind) {
      case "offer":
      case "counterOffer": {
        if (agreed) break; // a closed deal does not reopen
        let party = partyOfAddress(proposerOf(entry), parties);
        if (!party) {
          // Unknown proposer: the opening offer defaults to the buyer (the app
          // seeds it on the buyer's behalf); a counter alternates the party of
          // the message it answers, or of the previous proposer.
          if (payload.kind === "counterOffer") {
            const ancestor = payload.counterOf ? byReference.get(payload.counterOf) : undefined;
            const ancestorParty = ancestor ? partyOfAddress(proposerOf(ancestor), parties) : null;
            party = ancestorParty ? flip(ancestorParty) : lastProposerParty ? flip(lastProposerParty) : null;
          } else {
            party = lastProposerParty ? flip(lastProposerParty) : "buyer";
          }
        }
        if (party) lastProposerParty = party;
        latestOffer = entry;
        awaitingParty = party ? flip(party) : null;
        refused = null;
        break;
      }
      case "accept": {
        const referenced = payload.counterOf ? byReference.get(payload.counterOf) : undefined;
        const termsSource =
          referenced && referenced.payload.pricePerToken && referenced.payload.amount !== undefined
            ? referenced.payload
            : payload.pricePerToken && payload.amount !== undefined
              ? payload
              : undefined;
        agreed = {
          pricePerToken: termsSource?.pricePerToken ?? "",
          amount: termsSource?.amount ?? 0,
          acceptedMessageId: payload.counterOf ?? null,
          entry,
        };
        awaitingParty = null;
        refused = null;
        break;
      }
      case "refuse": {
        if (agreed) break; // a closed deal cannot be refused
        refused = entry;
        latestOffer = null;
        awaitingParty = null;
        break;
      }
      case "status": {
        if (payload.status === "purchased") {
          purchased = entry;
          awaitingParty = null;
        }
        break;
      }
    }
  }

  return { latestOffer, awaitingParty, agreed, refused, purchased };
}

/**
 * Converts a 9-decimal fixed-point quote to an exact GBP decimal string
 * (trailing zeros stripped), e.g. "123000000000" -> "123". Undefined when invalid.
 */
export function quoteToGbpDecimal(pricePerToken: string): string | undefined {
  const match = PRICE_PATTERN.exec(pricePerToken.trim());
  if (!match) return undefined;

  const digits = (match[1]! + (match[2] ?? "")).replace(/^0+(?=\d)/, "");
  const scale = (match[2]?.length ?? 0) + REALXMARKET_PRICE_DECIMALS;
  const padded = digits.padStart(scale + 1, "0");
  const integerPart = padded.slice(0, padded.length - scale).replace(/^0+(?=\d)/, "") || "0";
  const fractionPart = padded.slice(padded.length - scale).replace(/0+$/, "");
  return fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
}

function groupThousands(integerPart: string): string {
  return integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Display cap on fraction digits for a GBP quote ("up to 6 decimals", truncated). */
const GBP_DISPLAY_DECIMALS = 6;

/**
 * Formats a 9-decimal fixed-point quote as GBP with thousand separators and up
 * to 6 decimals, e.g. "123456789000" -> "£123.456789". Falls back to the raw
 * input when it is not a valid decimal string.
 */
export function formatGbpQuote(pricePerToken: string): string {
  const decimal = quoteToGbpDecimal(pricePerToken);
  if (decimal === undefined) return pricePerToken.trim();
  const [integerPart, fractionPart = ""] = decimal.split(".");
  const fraction = fractionPart.slice(0, GBP_DISPLAY_DECIMALS);
  return `£${groupThousands(integerPart!)}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Formats the order total (pricePerToken × amount) as GBP. Exact integer math
 * on the scaled quote — no floating point. Falls back to the empty string when
 * the inputs are invalid.
 */
export function formatGbpTotal(pricePerToken: string, amount: number): string {
  const match = PRICE_PATTERN.exec(pricePerToken.trim());
  if (!match || !isValidAmount(amount)) return "";

  const digits = (match[1]! + (match[2] ?? "")).replace(/^0+(?=\d)/, "") || "0";
  const scale = (match[2]?.length ?? 0) + REALXMARKET_PRICE_DECIMALS;
  const total = BigInt(digits) * BigInt(amount);
  const padded = total.toString().padStart(scale + 1, "0");
  const integerPart = padded.slice(0, padded.length - scale) || "0";
  const fractionPart = padded.slice(padded.length - scale).replace(/0+$/, "").slice(0, GBP_DISPLAY_DECIMALS);
  return `£${groupThousands(integerPart)}${fractionPart ? `.${fractionPart}` : ""}`;
}

/**
 * Converts a human-unit GBP price ("123.45") to the 9-decimal fixed-point
 * quote the protocol carries ("123450000000"). Undefined when invalid or zero.
 */
export function gbpToPricePerToken(gbp: string): string | undefined {
  const match = PRICE_PATTERN.exec(gbp.trim());
  if (!match) return undefined;
  const fractionPart = match[2] ?? "";
  if (fractionPart.length > REALXMARKET_PRICE_DECIMALS) return undefined;

  const raw =
    BigInt(match[1]!) * 10n ** BigInt(REALXMARKET_PRICE_DECIMALS) +
    (fractionPart ? BigInt(fractionPart.padEnd(REALXMARKET_PRICE_DECIMALS, "0")) : 0n);
  return raw > 0n ? raw.toString() : undefined;
}

/** Human label for a payload kind, used on the banner and chat summaries. */
export function realXmarketKindLabel(kind: RealXmarketKind): string {
  switch (kind) {
    case "offer":
      return "Offer";
    case "counterOffer":
      return "Counter-offer";
    case "accept":
      return "Acceptance";
    case "refuse":
      return "Refusal";
    case "status":
      return "Status";
  }
}

/** Readable one-line summary for a payload, used for chat bubbles. */
export function realXmarketPayloadSummary(payload: RealXmarketPayload): string {
  switch (payload.kind) {
    case "offer":
    case "counterOffer": {
      const label = payload.kind === "offer" ? "Offer" : "Counter-offer";
      const terms: string[] = [];
      if (payload.pricePerToken) terms.push(`${formatGbpQuote(payload.pricePerToken)} per token`);
      if (payload.amount !== undefined) terms.push(`× ${payload.amount}`);
      return terms.length ? `${label}: ${terms.join(" ")}` : label;
    }
    case "accept":
      return "Offer accepted";
    case "refuse":
      return "Offer refused";
    case "status":
      return payload.status === "purchased" ? "Purchased" : `Status: ${payload.status ?? "update"}`;
  }
}

/** Buyer/seller/asset ids annotated on a realXmarket bucket's properties. */
export interface RealXmarketBucketProperties {
  assetId?: string;
  shareListingId?: string;
  buyer?: string;
  seller?: string;
}

function unwrapPropertyValue(value: unknown): unknown {
  // The API stores bucket properties as a JSON string whose values may
  // themselves be stringified JSON ("{\"assetId\": \"12\"}") — unwrap once.
  if (typeof value === "string" && value.trim() !== "") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        return value;
      }
    }
  }
  return value;
}

/**
 * Parses the bucket properties JSON the app annotates realXmarket offer
 * buckets with ({ assetId, shareListingId, buyer, seller }). Tolerant of the
 * API's value-per-key string encoding and of key/value pair arrays; missing or
 * unreadable input yields an empty object rather than an error.
 */
export function parseRealXmarketBucketProperties(properties: string | null | undefined): RealXmarketBucketProperties {
  if (typeof properties !== "string" || properties.trim() === "") {
    return {};
  }

  let raw: unknown;
  try {
    raw = JSON.parse(properties);
  } catch {
    return {};
  }

  const collected: Record<string, unknown> = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      collected[key] = unwrapPropertyValue(value);
    }
  } else if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      const key = asOptionalString(record.key) ?? asOptionalString(record.name);
      if (key) collected[key] = unwrapPropertyValue(record.value);
    }
  }

  const result: RealXmarketBucketProperties = {};
  const assetId = asIdString(collected.assetId);
  const shareListingId = asIdString(collected.shareListingId);
  const buyer = asOptionalString(collected.buyer);
  const seller = asOptionalString(collected.seller);
  if (assetId) result.assetId = assetId;
  if (shareListingId) result.shareListingId = shareListingId;
  if (buyer) result.buyer = buyer;
  if (seller) result.seller = seller;
  return result;
}

const OFFER_BUCKET_NAME_PREFIX = "offer:";

/**
 * The property name encoded in an offer bucket's name ("Offer: <name>").
 * Empty string when the name carries no such prefix.
 */
export function parseOfferBucketPropertyName(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? "";
  if (!trimmed.toLowerCase().startsWith(OFFER_BUCKET_NAME_PREFIX)) {
    return "";
  }
  return trimmed.slice(OFFER_BUCKET_NAME_PREFIX.length).trim();
}
