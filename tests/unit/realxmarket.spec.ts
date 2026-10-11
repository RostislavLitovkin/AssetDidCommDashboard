import { describe, expect, it } from "vitest";
import type { ApiMessage } from "../../app/services/buckets/types";
import {
  REALXMARKET_ACCEPT_TAG,
  REALXMARKET_COUNTER_OFFER_TAG,
  REALXMARKET_OFFER_TAG,
  REALXMARKET_REFUSE_TAG,
  REALXMARKET_STATUS_TAG,
  REALXMARKET_TAGS,
  buildAcceptPayload,
  buildCounterOfferPayload,
  buildOfferPayload,
  buildRefusePayload,
  buildStatusPayload,
  deriveRealXmarketNegotiation,
  formatGbpQuote,
  formatGbpTotal,
  gbpToPricePerToken,
  isRealXmarketCategory,
  isRealXmarketTag,
  isValidPricePerToken,
  parseOfferBucketPropertyName,
  parseRealXmarketBucketProperties,
  parseRealXmarketPayload,
  quoteToGbpDecimal,
  realXmarketPayloadSummary,
  type RealXmarketEntry,
  type RealXmarketPayload,
} from "../../app/services/buckets/realxmarket";

const BUYER = "buyer-wallet-address";
const SELLER = "seller-wallet-address";
const PARTIES = { buyer: BUYER, seller: SELLER };

let messageSeq = 0;

function makeMessage(overrides: Partial<ApiMessage> = {}): ApiMessage {
  messageSeq += 1;
  return {
    id: `row-${messageSeq}`,
    messageId: String(messageSeq),
    bucketId: "bucket-1",
    contributor: BUYER,
    reference: null,
    tag: null,
    description: null,
    contentType: "application/json",
    contentHash: null,
    ipfsContent: null,
    createdAt: new Date(Date.UTC(2026, 9, 1, 12, 0, messageSeq)).toISOString(),
    ...overrides,
  };
}

function entryOf(kind: RealXmarketPayload["kind"], overrides: Partial<RealXmarketPayload> = {}, messageOverrides: Partial<ApiMessage> = {}): RealXmarketEntry {
  const base: RealXmarketPayload = {
    kind,
    version: 1,
    shareListingId: "7",
    assetId: "12",
    ...(kind === "offer" || kind === "counterOffer"
      ? { pricePerToken: "123000000000", amount: 5 }
      : {}),
    ...(kind === "status" ? { status: "purchased" } : {}),
    ...overrides,
  };
  return { message: makeMessage(messageOverrides), payload: base };
}

const TERMS = {
  shareListingId: "7",
  assetId: "12",
  pricePerToken: "123000000000",
  amount: 5,
  from: BUYER,
};

describe("realXmarket category and tags", () => {
  it("matches the realXmarket category case-insensitively", () => {
    expect(isRealXmarketCategory("realXmarket")).toBe(true);
    expect(isRealXmarketCategory("RealXmarket")).toBe(true);
    expect(isRealXmarketCategory("  REALXMARKET ")).toBe(true);
  });

  it("rejects other categories and missing values", () => {
    expect(isRealXmarketCategory("realXhub")).toBe(false);
    expect(isRealXmarketCategory("realXmarket extra")).toBe(false);
    expect(isRealXmarketCategory("")).toBe(false);
    expect(isRealXmarketCategory(null)).toBe(false);
    expect(isRealXmarketCategory(undefined)).toBe(false);
  });

  it("recognises every realXmarket tag and rejects others", () => {
    for (const tag of REALXMARKET_TAGS) {
      expect(isRealXmarketTag(tag)).toBe(true);
    }
    expect(isRealXmarketTag(REALXMARKET_OFFER_TAG)).toBe(true);
    expect(isRealXmarketTag("realXhub/offer")).toBe(false);
    expect(isRealXmarketTag("realXmarket/unknown")).toBe(false);
    expect(isRealXmarketTag("")).toBe(false);
    expect(isRealXmarketTag(null)).toBe(false);
    expect(isRealXmarketTag(undefined)).toBe(false);
  });
});

describe("pricePerToken validation", () => {
  it("accepts positive decimal strings", () => {
    expect(isValidPricePerToken("123000000000")).toBe(true);
    expect(isValidPricePerToken("0.000000001")).toBe(true);
    expect(isValidPricePerToken("1.5")).toBe(true);
  });

  it("rejects zero, negatives and malformed values", () => {
    expect(isValidPricePerToken("0")).toBe(false);
    expect(isValidPricePerToken("0.000")).toBe(false);
    expect(isValidPricePerToken("-5")).toBe(false);
    expect(isValidPricePerToken("abc")).toBe(false);
    expect(isValidPricePerToken("1.2.3")).toBe(false);
    expect(isValidPricePerToken("")).toBe(false);
  });
});

describe("payload builders and parser", () => {
  it("round-trips an offer payload", () => {
    expect(parseRealXmarketPayload(buildOfferPayload(TERMS))).toEqual({
      kind: "offer",
      version: 1,
      shareListingId: "7",
      assetId: "12",
      pricePerToken: "123000000000",
      amount: 5,
      counterOf: null,
      from: BUYER,
    });
  });

  it("round-trips a counter-offer with its reference", () => {
    expect(parseRealXmarketPayload(buildCounterOfferPayload({ ...TERMS, from: SELLER, counterOf: "3" }))).toEqual({
      kind: "counterOffer",
      version: 1,
      shareListingId: "7",
      assetId: "12",
      pricePerToken: "123000000000",
      amount: 5,
      counterOf: "3",
      from: SELLER,
    });
  });

  it("round-trips an accept carrying the accepted message id in counterOf", () => {
    expect(parseRealXmarketPayload(buildAcceptPayload({ ...TERMS, from: SELLER, counterOf: "9" }))).toEqual({
      kind: "accept",
      version: 1,
      shareListingId: "7",
      assetId: "12",
      pricePerToken: "123000000000",
      amount: 5,
      counterOf: "9",
      from: SELLER,
    });
  });

  it("round-trips a refuse payload without terms", () => {
    expect(parseRealXmarketPayload(buildRefusePayload({ shareListingId: "7", assetId: "12", from: SELLER, counterOf: "9" }))).toEqual({
      kind: "refuse",
      version: 1,
      shareListingId: "7",
      assetId: "12",
      counterOf: "9",
      from: SELLER,
    });
  });

  it("round-trips a purchased status with a transaction signature", () => {
    expect(parseRealXmarketPayload(buildStatusPayload({
      shareListingId: "7",
      assetId: "12",
      status: "purchased",
      tx: "5xSignature",
    }))).toEqual({
      kind: "status",
      version: 1,
      shareListingId: "7",
      assetId: "12",
      counterOf: null,
      status: "purchased",
      tx: "5xSignature",
    });
  });

  it("accepts an already-decoded object (plaintext seed tolerance)", () => {
    const seed = {
      kind: "offer",
      version: 1,
      shareListingId: "7",
      assetId: "12",
      pricePerToken: "123000000000",
      amount: 5,
      counterOf: null,
      from: BUYER,
    };
    expect(parseRealXmarketPayload(seed)).toEqual(seed);
    expect(parseRealXmarketPayload(JSON.stringify(seed))).toEqual(seed);
  });

  it("rejects the wrong protocol version and unknown kinds", () => {
    expect(parseRealXmarketPayload(JSON.stringify({ kind: "offer", version: 2, shareListingId: "7", assetId: "12", pricePerToken: "1", amount: 1 }))).toBeUndefined();
    expect(parseRealXmarketPayload(JSON.stringify({ kind: "offer", shareListingId: "7", assetId: "12", pricePerToken: "1", amount: 1 }))).toBeUndefined();
    expect(parseRealXmarketPayload(JSON.stringify({ kind: "payment", version: 1, shareListingId: "7", assetId: "12" }))).toBeUndefined();
    expect(parseRealXmarketPayload("{ not json")).toBeUndefined();
    expect(parseRealXmarketPayload("")).toBeUndefined();
    expect(parseRealXmarketPayload(undefined)).toBeUndefined();
    expect(parseRealXmarketPayload(["offer"])).toBeUndefined();
  });

  it("rejects missing ids and invalid terms", () => {
    expect(parseRealXmarketPayload(JSON.stringify({ kind: "offer", version: 1, assetId: "12", pricePerToken: "1", amount: 1 }))).toBeUndefined();
    expect(parseRealXmarketPayload(JSON.stringify({ kind: "offer", version: 1, shareListingId: "7", assetId: "12", amount: 1 }))).toBeUndefined();
    expect(parseRealXmarketPayload(JSON.stringify({ kind: "offer", version: 1, shareListingId: "7", assetId: "12", pricePerToken: "0", amount: 1 }))).toBeUndefined();
    expect(parseRealXmarketPayload(JSON.stringify({ kind: "offer", version: 1, shareListingId: "7", assetId: "12", pricePerToken: "1", amount: 0 }))).toBeUndefined();
    expect(parseRealXmarketPayload(JSON.stringify({ kind: "offer", version: 1, shareListingId: "7", assetId: "12", pricePerToken: "1", amount: 1.5 }))).toBeUndefined();
    expect(parseRealXmarketPayload(JSON.stringify({ kind: "counterOffer", version: 1, shareListingId: "7", assetId: "12", pricePerToken: "abc", amount: 1 }))).toBeUndefined();
    expect(parseRealXmarketPayload(JSON.stringify({ kind: "status", version: 1, shareListingId: "7", assetId: "12" }))).toBeUndefined();
  });

  it("accepts numeric ids and prices by stringifying them", () => {
    expect(parseRealXmarketPayload(JSON.stringify({ kind: "offer", version: 1, shareListingId: 7, assetId: 12, pricePerToken: 150000000, amount: 2 }))).toMatchObject({
      shareListingId: "7",
      assetId: "12",
      pricePerToken: "150000000",
    });
  });

  it("builders throw on invalid terms instead of emitting protocol violations", () => {
    expect(() => buildOfferPayload({ ...TERMS, pricePerToken: "0" })).toThrow();
    expect(() => buildOfferPayload({ ...TERMS, pricePerToken: "abc" })).toThrow();
    expect(() => buildOfferPayload({ ...TERMS, amount: 0 })).toThrow();
    expect(() => buildOfferPayload({ ...TERMS, amount: 2.5 })).toThrow();
    expect(() => buildOfferPayload({ ...TERMS, shareListingId: "" })).toThrow();
    expect(() => buildCounterOfferPayload({ ...TERMS, counterOf: "" })).toThrow();
    expect(() => buildAcceptPayload({ ...TERMS, counterOf: "" })).toThrow();
    expect(() => buildStatusPayload({ shareListingId: "7", assetId: "12", status: "" })).toThrow();
  });

  it("summarizes payloads in a human-readable line", () => {
    expect(realXmarketPayloadSummary({ kind: "offer", version: 1, shareListingId: "7", assetId: "12", pricePerToken: "123000000000", amount: 5 })).toBe("Offer: £123 per token × 5");
    expect(realXmarketPayloadSummary({ kind: "counterOffer", version: 1, shareListingId: "7", assetId: "12", pricePerToken: "100000000000", amount: 3 })).toBe("Counter-offer: £100 per token × 3");
    expect(realXmarketPayloadSummary({ kind: "accept", version: 1, shareListingId: "7", assetId: "12" })).toBe("Offer accepted");
    expect(realXmarketPayloadSummary({ kind: "refuse", version: 1, shareListingId: "7", assetId: "12" })).toBe("Offer refused");
    expect(realXmarketPayloadSummary({ kind: "status", version: 1, shareListingId: "7", assetId: "12", status: "purchased" })).toBe("Purchased");
  });
});

describe("GBP quote formatting", () => {
  it("converts the 9-decimal fixed point to a GBP decimal string exactly", () => {
    expect(quoteToGbpDecimal("123000000000")).toBe("123");
    expect(quoteToGbpDecimal("150000000")).toBe("0.15");
    expect(quoteToGbpDecimal("1234567891")).toBe("1.234567891");
    expect(quoteToGbpDecimal("1")).toBe("0.000000001");
    expect(quoteToGbpDecimal("abc")).toBeUndefined();
  });

  it("formats quotes with the £ sign, grouping and up to 6 decimals", () => {
    expect(formatGbpQuote("123000000000")).toBe("£123");
    expect(formatGbpQuote("150000000")).toBe("£0.15");
    expect(formatGbpQuote("1234500000000")).toBe("£1,234.5");
    // 1.23456789 GBP truncates (never rounds) at 6 decimals.
    expect(formatGbpQuote("1234567890")).toBe("£1.234567");
    expect(formatGbpQuote("not-a-price")).toBe("not-a-price");
  });

  it("formats totals with exact integer math", () => {
    expect(formatGbpTotal("150000000", 40)).toBe("£6");
    expect(formatGbpTotal("123000000000", 5)).toBe("£615");
    expect(formatGbpTotal("150000000", 3)).toBe("£0.45");
    expect(formatGbpTotal("123000000000", 0)).toBe("");
  });

  it("converts human GBP input back to the 9-decimal quote", () => {
    expect(gbpToPricePerToken("123.45")).toBe("123450000000");
    expect(gbpToPricePerToken("1")).toBe("1000000000");
    expect(gbpToPricePerToken("0.000000001")).toBe("1");
    expect(gbpToPricePerToken("0")).toBeUndefined();
    expect(gbpToPricePerToken("0.0000000001")).toBeUndefined();
    expect(gbpToPricePerToken("abc")).toBeUndefined();
  });
});

describe("negotiation state machine", () => {
  it("is empty when there are no messages", () => {
    const n = deriveRealXmarketNegotiation([], PARTIES);
    expect(n).toEqual({ latestOffer: null, awaitingParty: null, agreed: null, refused: null, purchased: null });
  });

  it("a buyer offer awaits the seller", () => {
    const offer = entryOf("offer", { from: BUYER });
    const n = deriveRealXmarketNegotiation([offer], PARTIES);
    expect(n.latestOffer).toBe(offer);
    expect(n.awaitingParty).toBe("seller");
    expect(n.agreed).toBeNull();
  });

  it("a seller offer awaits the buyer", () => {
    const offer = entryOf("offer", { from: SELLER });
    const n = deriveRealXmarketNegotiation([offer], PARTIES);
    expect(n.awaitingParty).toBe("buyer");
  });

  it("defaults the first offer to the buyer when the parties are unknown", () => {
    const offer = entryOf("offer", { from: "some-unknown-wallet" });
    const n = deriveRealXmarketNegotiation([offer], {});
    expect(n.awaitingParty).toBe("seller");
  });

  it("a counter-offer supersedes the offer it counters and flips the awaiting party", () => {
    const offer = entryOf("offer", { from: BUYER });
    const counter = entryOf("counterOffer", { from: SELLER, pricePerToken: "100000000000", counterOf: offer.message.messageId });
    const n = deriveRealXmarketNegotiation([offer, counter], PARTIES);
    expect(n.latestOffer).toBe(counter);
    expect(n.awaitingParty).toBe("buyer");
  });

  it("walks a counter chain with the awaiting party alternating", () => {
    const offer = entryOf("offer", { from: BUYER });
    const counter1 = entryOf("counterOffer", { from: SELLER, counterOf: offer.message.messageId });
    const counter2 = entryOf("counterOffer", { from: BUYER, counterOf: counter1.message.messageId });
    const counter3 = entryOf("counterOffer", { from: SELLER, counterOf: counter2.message.messageId });

    expect(deriveRealXmarketNegotiation([offer, counter1, counter2], PARTIES).awaitingParty).toBe("seller");
    const n = deriveRealXmarketNegotiation([offer, counter1, counter2, counter3], PARTIES);
    expect(n.latestOffer).toBe(counter3);
    expect(n.awaitingParty).toBe("buyer");
  });

  it("an accept agrees the terms of the message it references", () => {
    const offer = entryOf("offer", { from: BUYER });
    const counter = entryOf("counterOffer", { from: SELLER, pricePerToken: "99000000000", amount: 4, counterOf: offer.message.messageId });
    const accept = entryOf("accept", { from: BUYER, counterOf: counter.message.messageId });

    const n = deriveRealXmarketNegotiation([offer, counter, accept], PARTIES);
    expect(n.agreed).not.toBeNull();
    expect(n.agreed?.pricePerToken).toBe("99000000000");
    expect(n.agreed?.amount).toBe(4);
    expect(n.agreed?.acceptedMessageId).toBe(counter.message.messageId);
    expect(n.awaitingParty).toBeNull();
    expect(n.refused).toBeNull();
  });

  it("resolves an accept reference carried as the API row id too", () => {
    const offer = entryOf("offer", { from: BUYER });
    const accept = entryOf("accept", { from: SELLER, counterOf: offer.message.id });

    const n = deriveRealXmarketNegotiation([offer, accept], PARTIES);
    expect(n.agreed?.pricePerToken).toBe("123000000000");
    expect(n.agreed?.amount).toBe(5);
  });

  it("falls back to the accept payload's own terms when the reference is unknown", () => {
    const offer = entryOf("offer", { from: BUYER });
    const accept = entryOf("accept", { from: SELLER, counterOf: "999", pricePerToken: "88000000000", amount: 2 });

    const n = deriveRealXmarketNegotiation([offer, accept], PARTIES);
    expect(n.agreed?.pricePerToken).toBe("88000000000");
    expect(n.agreed?.amount).toBe(2);
  });

  it("a refuse clears the table and records the refusal", () => {
    const offer = entryOf("offer", { from: BUYER });
    const refuse = entryOf("refuse", { from: SELLER, counterOf: offer.message.messageId });

    const n = deriveRealXmarketNegotiation([offer, refuse], PARTIES);
    expect(n.latestOffer).toBeNull();
    expect(n.awaitingParty).toBeNull();
    expect(n.refused).toBe(refuse);
    expect(n.agreed).toBeNull();
  });

  it("a fresh offer after a refusal starts a new round", () => {
    const offer = entryOf("offer", { from: BUYER });
    const refuse = entryOf("refuse", { from: SELLER, counterOf: offer.message.messageId });
    const renewed = entryOf("offer", { from: SELLER, pricePerToken: "110000000000" });

    const n = deriveRealXmarketNegotiation([offer, refuse, renewed], PARTIES);
    expect(n.latestOffer).toBe(renewed);
    expect(n.refused).toBeNull();
    expect(n.awaitingParty).toBe("buyer");
  });

  it("later offers and refusals do not reopen an agreed deal", () => {
    const offer = entryOf("offer", { from: BUYER });
    const accept = entryOf("accept", { from: SELLER, counterOf: offer.message.messageId });
    const lateOffer = entryOf("offer", { from: BUYER, pricePerToken: "1" });
    const lateRefuse = entryOf("refuse", { from: SELLER });

    const n = deriveRealXmarketNegotiation([offer, accept, lateOffer, lateRefuse], PARTIES);
    expect(n.agreed).not.toBeNull();
    expect(n.agreed?.pricePerToken).toBe("123000000000");
    expect(n.refused).toBeNull();
    expect(n.awaitingParty).toBeNull();
  });

  it("purchased is terminal and ignores everything after it", () => {
    const offer = entryOf("offer", { from: BUYER });
    const accept = entryOf("accept", { from: SELLER, counterOf: offer.message.messageId });
    const purchased = entryOf("status", { status: "purchased", tx: "sig-1" });
    const after = entryOf("offer", { from: BUYER, pricePerToken: "1" });

    const n = deriveRealXmarketNegotiation([offer, accept, purchased, after], PARTIES);
    expect(n.purchased).toBe(purchased);
    expect(n.purchased?.payload.tx).toBe("sig-1");
    expect(n.latestOffer).toBe(offer);
    expect(n.agreed).not.toBeNull();
    expect(n.awaitingParty).toBeNull();
  });

  it("ignores non-purchased status messages for the state", () => {
    const offer = entryOf("offer", { from: BUYER });
    const note = entryOf("status", { status: "viewed" });

    const n = deriveRealXmarketNegotiation([offer, note], PARTIES);
    expect(n.purchased).toBeNull();
    expect(n.latestOffer).toBe(offer);
    expect(n.awaitingParty).toBe("seller");
  });

  it("breaks same-timestamp ties by numeric messageId", () => {
    const sharedTime = "2026-10-01T12:00:00.000Z";
    const offer = entryOf("offer", { from: BUYER }, { messageId: "5", createdAt: sharedTime });
    const counter = entryOf("counterOffer", { from: SELLER, counterOf: "5" }, { messageId: "6", createdAt: sharedTime });

    const n = deriveRealXmarketNegotiation([counter, offer], PARTIES);
    expect(n.latestOffer).toBe(counter);
    expect(n.awaitingParty).toBe("buyer");
  });
});

describe("bucket properties parsing", () => {
  it("parses the plain object form", () => {
    expect(parseRealXmarketBucketProperties(JSON.stringify({
      assetId: "12", shareListingId: "7", buyer: BUYER, seller: SELLER,
    }))).toEqual({ assetId: "12", shareListingId: "7", buyer: BUYER, seller: SELLER });
  });

  it("unwraps values stored as stringified JSON and stringifies numeric ids", () => {
    expect(parseRealXmarketBucketProperties(JSON.stringify({
      assetId: "12",
      shareListingId: 7,
      buyer: `"${BUYER}"`,
      seller: SELLER,
    }))).toEqual({ assetId: "12", shareListingId: "7", buyer: BUYER, seller: SELLER });
  });

  it("accepts key/value pair arrays", () => {
    expect(parseRealXmarketBucketProperties(JSON.stringify([
      { key: "assetId", value: "12" },
      { key: "shareListingId", value: "7" },
      { key: "buyer", value: BUYER },
      { key: "seller", value: SELLER },
    ]))).toEqual({ assetId: "12", shareListingId: "7", buyer: BUYER, seller: SELLER });
  });

  it("yields an empty object for missing or unreadable input", () => {
    expect(parseRealXmarketBucketProperties(null)).toEqual({});
    expect(parseRealXmarketBucketProperties(undefined)).toEqual({});
    expect(parseRealXmarketBucketProperties("")).toEqual({});
    expect(parseRealXmarketBucketProperties("{ not json")).toEqual({});
    expect(parseRealXmarketBucketProperties(JSON.stringify({ unrelated: 1 }))).toEqual({});
  });
});

describe("offer bucket property name", () => {
  it("reads the name after the 'Offer: ' prefix, case-insensitively", () => {
    expect(parseOfferBucketPropertyName("Offer: Sunset Villa")).toBe("Sunset Villa");
    expect(parseOfferBucketPropertyName("offer:  Sunflower Apartments ")).toBe("Sunflower Apartments");
  });

  it("returns empty when the prefix is absent or the name missing", () => {
    expect(parseOfferBucketPropertyName("Sunset Villa")).toBe("");
    expect(parseOfferBucketPropertyName(null)).toBe("");
    expect(parseOfferBucketPropertyName(undefined)).toBe("");
  });
});

describe("negotiation tags constant", () => {
  it("exposes all five protocol tags", () => {
    expect(REALXMARKET_TAGS).toEqual([
      REALXMARKET_OFFER_TAG,
      REALXMARKET_COUNTER_OFFER_TAG,
      REALXMARKET_ACCEPT_TAG,
      REALXMARKET_REFUSE_TAG,
      REALXMARKET_STATUS_TAG,
    ]);
  });
});
