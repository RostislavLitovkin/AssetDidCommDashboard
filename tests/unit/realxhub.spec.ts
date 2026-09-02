import { describe, expect, it } from "vitest";
import type { ApiMessage } from "../../app/services/buckets/types";
import {
  DEFAULT_OFFER_TOKEN,
  SOLANA_TOKENS,
  buildMarketPayload,
  buildStatusPayload,
  defaultStatusForRole,
  deriveActiveOffer,
  formatPriceAmount,
  isRealXhubCategory,
  isRealXhubTag,
  marketPayloadSummary,
  parseMarketPayload,
  parseSolanaToken,
  parseStatusPayload,
  priceToRawUnits,
  resolveMarketStatus,
  tokenClusterLabel,
  REALXHUB_COUNTER_OFFER_TAG,
  REALXHUB_OFFER_TAG,
  REALXHUB_REFUSE_COUNTER_OFFER_TAG,
  REALXHUB_STATUS_TAG,
} from "../../app/services/buckets/realxhub";

let messageSeq = 0;

function makeMessage(overrides: Partial<ApiMessage> = {}): ApiMessage {
  messageSeq += 1;
  return {
    id: `msg-${messageSeq}`,
    messageId: String(messageSeq),
    bucketId: "bucket-1",
    contributor: "address-a",
    reference: null,
    tag: null,
    description: null,
    contentType: null,
    contentHash: null,
    ipfsContent: null,
    createdAt: new Date(Date.UTC(2026, 8, 1, 12, 0, messageSeq)).toISOString(),
    ...overrides,
  };
}

describe("realxhub category matching", () => {
  it("matches the realXhub category case-insensitively", () => {
    expect(isRealXhubCategory("realXhub")).toBe(true);
    expect(isRealXhubCategory("RealXhub")).toBe(true);
    expect(isRealXhubCategory("  REALXHUB  ")).toBe(true);
    expect(isRealXhubCategory("realxhub ")).toBe(true);
  });

  it("rejects other categories and missing values", () => {
    expect(isRealXhubCategory("marketplace")).toBe(false);
    expect(isRealXhubCategory("realXhub extra")).toBe(false);
    expect(isRealXhubCategory("")).toBe(false);
    expect(isRealXhubCategory(null)).toBe(false);
    expect(isRealXhubCategory(undefined)).toBe(false);
  });
});

describe("solana token whitelist", () => {
  it("lists the three devnet tokens with the shipped mints", () => {
    expect(SOLANA_TOKENS.map((token) => token.symbol)).toEqual(["tUSDC", "XCAV", "tGBP"]);
    expect(SOLANA_TOKENS.every((token) => token.cluster === "solana-devnet")).toBe(true);
    expect(SOLANA_TOKENS.map((token) => token.mint)).toEqual([
      "8umv4NXybZFGiT3tQb1DqJ6DXxLa3rLNhPbcqbQsjXxW",
      "8dW943dozaNPdRRaW6xpV2vxFv1Kcpz3z63Nji3VLups",
      "71G3dc4B9p9QBosLx3XhWY3ULRPAxjopngsin66M9HUb"
    ]);
  });

  it("defaults new offers to tGBP on devnet", () => {
    expect(DEFAULT_OFFER_TOKEN.symbol).toBe("tGBP");
    expect(DEFAULT_OFFER_TOKEN.cluster).toBe("solana-devnet");
    expect(DEFAULT_OFFER_TOKEN.decimals).toBe(9);
  });

  it("labels the clusters for display", () => {
    expect(tokenClusterLabel("solana-devnet")).toBe("Solana Devnet");
    expect(tokenClusterLabel("solana-mainnet")).toBe("Solana Mainnet");
  });
});

describe("market payload codec", () => {
  const offer = {
    kind: "offer" as const,
    price: "10.5",
    token: { cluster: "solana-devnet" as const, mint: "71G3dc4B9p9QBosLx3XhWY3ULRPAxjopngsin66M9HUb", symbol: "tGBP", decimals: 9 },
  };

  it("round-trips an offer payload", () => {
    expect(parseMarketPayload(buildMarketPayload(offer))).toEqual(offer);
  });

  it("round-trips a counter-offer with its reference", () => {
    const counter = { ...offer, kind: "counterOffer" as const, price: "8", counterOf: "42" };
    expect(parseMarketPayload(buildMarketPayload(counter))).toEqual(counter);
  });

  it("round-trips a refusal payload", () => {
    const refusal = { kind: "refuse" as const, refusedOf: "42" };
    expect(parseMarketPayload(buildMarketPayload(refusal))).toEqual(refusal);
  });

  it("rejects malformed JSON", () => {
    expect(parseMarketPayload("{ not json")).toBeUndefined();
    expect(parseMarketPayload("")).toBeUndefined();
    expect(parseMarketPayload(undefined)).toBeUndefined();
  });

  it("rejects unknown kinds and non-object bodies", () => {
    expect(parseMarketPayload(JSON.stringify({ kind: "payment", price: "1" }))).toBeUndefined();
    expect(parseMarketPayload(JSON.stringify(["offer"]))).toBeUndefined();
    expect(parseMarketPayload(JSON.stringify("offer"))).toBeUndefined();
  });

  it("rejects offers with a missing or invalid price or token", () => {
    expect(parseMarketPayload(JSON.stringify({ kind: "offer", token: offer.token }))).toBeUndefined();
    expect(parseMarketPayload(JSON.stringify({ kind: "offer", price: "10" }))).toBeUndefined();
    expect(parseMarketPayload(JSON.stringify({ kind: "offer", price: "abc", token: offer.token }))).toBeUndefined();
    expect(parseMarketPayload(JSON.stringify({ kind: "offer", price: "-5", token: offer.token }))).toBeUndefined();
    expect(parseMarketPayload(JSON.stringify({ kind: "counterOffer", price: "1" }))).toBeUndefined();
  });

  it("rejects tokens with unsupported clusters or fields", () => {
    const bad = { cluster: "polkadot-mainnet", mint: "m", symbol: "DOT", decimals: 10 };
    expect(parseSolanaToken(bad)).toBeUndefined();
    expect(parseSolanaToken({ cluster: "solana-devnet", mint: "", symbol: "X", decimals: 9 })).toBeUndefined();
    expect(parseSolanaToken({ cluster: "solana-devnet", mint: "m", symbol: "X", decimals: 9.5 })).toBeUndefined();
    expect(parseSolanaToken(null)).toBeUndefined();
  });

  it("summarizes payloads in a human-readable line", () => {
    expect(marketPayloadSummary(offer)).toBe("Offer: 10.5 tGBP");
    expect(marketPayloadSummary({ ...offer, kind: "counterOffer" })).toBe("Counter-offer: 10.5 tGBP");
    expect(marketPayloadSummary({ kind: "refuse", refusedOf: "7" })).toBe("Counter-offer refused");
  });
});

describe("status payload codec", () => {
  it("round-trips a status payload", () => {
    expect(parseStatusPayload(buildStatusPayload({ address: "addr-1", status: "seller" })))
      .toEqual({ address: "addr-1", status: "seller" });
  });

  it("rejects invalid statuses and addresses", () => {
    expect(parseStatusPayload(JSON.stringify({ address: "addr-1", status: "moderator" }))).toBeUndefined();
    expect(parseStatusPayload(JSON.stringify({ address: "", status: "buyer" }))).toBeUndefined();
    expect(parseStatusPayload("nope")).toBeUndefined();
  });

  it("defaults admin to seller and everyone else to buyer", () => {
    expect(defaultStatusForRole("admin")).toBe("seller");
    expect(defaultStatusForRole("contributor")).toBe("buyer");
    expect(defaultStatusForRole("viewer")).toBe("buyer");
    expect(defaultStatusForRole(null)).toBe("buyer");
  });

  it("resolves the latest status for an address, falling back to the role default", () => {
    const statuses = [
      { address: "ADDR-1", status: "seller" as const },
      { address: "addr-2", status: "seller" as const },
      { address: "addr-1", status: "buyer" as const },
    ];
    expect(resolveMarketStatus("Addr-1", "admin", statuses)).toBe("buyer");
    expect(resolveMarketStatus("addr-2", "contributor", statuses)).toBe("seller");
    expect(resolveMarketStatus("addr-3", "contributor", statuses)).toBe("buyer");
    expect(resolveMarketStatus("addr-3", "admin", statuses)).toBe("seller");
  });
});

describe("active offer state machine", () => {
  const offerMessage = makeMessage({ tag: REALXHUB_OFFER_TAG, messageId: "1" });
  const counterMessage = makeMessage({ tag: REALXHUB_COUNTER_OFFER_TAG, messageId: "2" });
  const refusalMessage = makeMessage({ tag: REALXHUB_REFUSE_COUNTER_OFFER_TAG, messageId: "3" });

  const offerPayload = { kind: "offer" as const, price: "10", token: DEFAULT_OFFER_TOKEN };
  const counterPayload = { kind: "counterOffer" as const, price: "7", token: DEFAULT_OFFER_TOKEN, counterOf: "1" };
  const refusalPayload = { kind: "refuse" as const, refusedOf: "2" };

  it("keeps an offer active on its own", () => {
    const active = deriveActiveOffer([{ message: offerMessage, payload: offerPayload }]);
    expect(active?.type).toBe("offer");
    expect(active?.message.id).toBe(offerMessage.id);
  });

  it("lets a counter-offer supersede the offer", () => {
    const active = deriveActiveOffer([
      { message: offerMessage, payload: offerPayload },
      { message: counterMessage, payload: counterPayload },
    ]);
    expect(active?.type).toBe("counterOffer");
    expect(active?.payload.price).toBe("7");
  });

  it("clears the active state on a refusal", () => {
    const active = deriveActiveOffer([
      { message: offerMessage, payload: offerPayload },
      { message: counterMessage, payload: counterPayload },
      { message: refusalMessage, payload: refusalPayload },
    ]);
    expect(active).toBeNull();
  });

  it("treats a newer offer as the only active one, superseding the refusal", () => {
    const renewedMessage = makeMessage({ tag: REALXHUB_OFFER_TAG, messageId: "4" });
    const active = deriveActiveOffer([
      { message: offerMessage, payload: offerPayload },
      { message: counterMessage, payload: counterPayload },
      { message: refusalMessage, payload: refusalPayload },
      { message: renewedMessage, payload: { ...offerPayload, price: "12" } },
    ]);
    expect(active?.type).toBe("offer");
    expect(active?.message.id).toBe(renewedMessage.id);
    expect(active?.payload.price).toBe("12");
  });

  it("breaks ties on the same timestamp by numeric messageId", () => {
    const sharedTime = "2026-09-01T12:00:00.000Z";
    const early = makeMessage({ tag: REALXHUB_OFFER_TAG, messageId: "5", createdAt: sharedTime });
    const late = makeMessage({ tag: REALXHUB_COUNTER_OFFER_TAG, messageId: "6", createdAt: sharedTime });
    const active = deriveActiveOffer([
      { message: late, payload: counterPayload },
      { message: early, payload: offerPayload },
    ]);
    expect(active?.type).toBe("counterOffer");
  });

});

describe("price formatting and raw units", () => {
  it("strips trailing zeros without touching the integer part", () => {
    expect(formatPriceAmount("10.50")).toBe("10.5");
    expect(formatPriceAmount("10.00")).toBe("10");
    expect(formatPriceAmount("10")).toBe("10");
    expect(formatPriceAmount("0.010")).toBe("0.01");
    expect(formatPriceAmount("not-a-number")).toBe("not-a-number");
  });

  it("converts human units to raw units exactly", () => {
    expect(priceToRawUnits("10.5", 9)).toBe(10_500_000_000n);
    expect(priceToRawUnits("10", 6)).toBe(10_000_000n);
    expect(priceToRawUnits("0.000001", 6)).toBe(1n);
    expect(priceToRawUnits("0", 9)).toBe(0n);
  });

  it("rejects over-precise fractions and malformed input", () => {
    expect(priceToRawUnits("1.123", 2)).toBeUndefined();
    expect(priceToRawUnits("abc", 2)).toBeUndefined();
    expect(priceToRawUnits("1", -1)).toBeUndefined();
  });
});

describe("status tag constant", () => {
  it("exposes the status tag for member status messages", () => {
    expect(REALXHUB_STATUS_TAG).toBe("realXhub/status");
  });
});

describe("isRealXhubTag", () => {
  it("recognises every realXhub tag", () => {
    expect(isRealXhubTag(REALXHUB_OFFER_TAG)).toBe(true);
    expect(isRealXhubTag(REALXHUB_COUNTER_OFFER_TAG)).toBe(true);
    expect(isRealXhubTag(REALXHUB_REFUSE_COUNTER_OFFER_TAG)).toBe(true);
    expect(isRealXhubTag(REALXHUB_STATUS_TAG)).toBe(true);
  });

  it("rejects other tags and empty values", () => {
    expect(isRealXhubTag("claim/request")).toBe(false);
    expect(isRealXhubTag("realXhub/unknown")).toBe(false);
    expect(isRealXhubTag("")).toBe(false);
    expect(isRealXhubTag(null)).toBe(false);
    expect(isRealXhubTag(undefined)).toBe(false);
  });
});
