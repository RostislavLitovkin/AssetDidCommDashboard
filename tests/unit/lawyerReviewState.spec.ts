import { describe, expect, it } from "vitest";
import type { IndexerLegalListing } from "../../app/services/lawyer/indexerLegalClient";
import { deriveLawyerReviewState, loadLawyerReviewState } from "../../app/services/lawyer/reviewState";
import type { LawyerReviewBucketMetadata } from "../../app/services/lawyer/types";

const bucket: LawyerReviewBucketMetadata = {
  propertyId: "42",
  cluster: "devnet",
  spvLawyer: "SpvWallet",
  developerLawyer: "DeveloperWallet",
  listingPda: "ListingPda",
  propertyPda: "PropertyPda",
};

const settlement = {
  regionId: 3,
  developer: "Developer",
  developerLawyer: "DeveloperWallet",
  spvLawyer: "SpvWallet",
  xcavMint: "XcavMint",
  treasury: "Treasury",
  acceptedPaymentMints: ["MintA", "MintB"],
  collectedMints: ["MintB", "MintA"],
};

function listing(overrides: Partial<IndexerLegalListing> = {}): IndexerLegalListing {
  return {
    listingId: "42",
    assetId: "42",
    spvLawyer: "SpvWallet",
    spvVerdict: "pending",
    spvDocumentsHash: "0x00",
    developerLawyer: "DeveloperWallet",
    developerVerdict: "pending",
    developerDocumentsHash: "0x00",
    secondAttempt: false,
    status: "SOLD_OUT",
    legalDeadline: 1_900_000_000,
    ...overrides,
  };
}

function stubFetcher(payload: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe("deriveLawyerReviewState", () => {
  it("derives zero pending percentages from two pending seats", () => {
    const state = deriveLawyerReviewState(listing(), bucket, null);
    expect(state.counts).toEqual({ approved: 0, rejected: 0, pending: 2 });
    expect(state.percentages).toEqual({ approved: 0, rejected: 0, pending: 100 });
    expect(state.attempt).toBe(1);
    expect(state.settlementReady).toBe(false);
  });

  it("derives 50 percent approval and pending counts", () => {
    const state = deriveLawyerReviewState(listing({ spvVerdict: "approved", spvDocumentsHash: "0xabc" }), bucket, null);
    expect(state.counts).toEqual({ approved: 1, rejected: 0, pending: 1 });
    expect(state.percentages).toEqual({ approved: 50, rejected: 0, pending: 50 });
  });

  it("derives 50 percent rejection and pending counts", () => {
    const state = deriveLawyerReviewState(listing({ developerVerdict: "rejected" }), bucket, null);
    expect(state.counts).toEqual({ approved: 0, rejected: 1, pending: 1 });
    expect(state.percentages).toEqual({ approved: 0, rejected: 50, pending: 50 });
  });

  it("represents two matching approvals as Legal and settlement-ready only with executeDeal evidence", () => {
    const approved = listing({
      spvVerdict: "approved",
      spvDocumentsHash: "0xABC",
      developerVerdict: "approved",
      developerDocumentsHash: "0xabc",
      status: "LEGAL",
    });
    const state = deriveLawyerReviewState(approved, bucket, settlement);
    expect(state.counts).toEqual({ approved: 2, rejected: 0, pending: 0 });
    expect(state.percentages).toEqual({ approved: 100, rejected: 0, pending: 0 });
    expect(state.status).toBe("LEGAL");
    expect(state.hashMismatch).toBe(false);
    expect(state.settlementReady).toBe(true);
    expect(state.settlement).toEqual(settlement);
    expect(deriveLawyerReviewState(approved, bucket, null).settlementReady).toBe(false);
  });

  it("represents two rejections as cancelled with 100 percent rejection", () => {
    const state = deriveLawyerReviewState(listing({
      spvVerdict: "rejected",
      developerVerdict: "rejected",
      status: "CANCELLED",
    }), bucket, null);
    expect(state.percentages).toEqual({ approved: 0, rejected: 100, pending: 0 });
    expect(state.status).toBe("CANCELLED");
    expect(state.settlementReady).toBe(false);
  });

  it("shows the first split verdict as the second attempt", () => {
    const state = deriveLawyerReviewState(listing({
      spvVerdict: "approved",
      developerVerdict: "rejected",
      secondAttempt: true,
    }), bucket, null);
    expect(state.attempt).toBe(2);
    expect(state.status).toBe("SOLD_OUT");
    expect(state.percentages).toEqual({ approved: 50, rejected: 50, pending: 0 });
  });

  it("shows a second split verdict as cancelled", () => {
    const state = deriveLawyerReviewState(listing({
      spvVerdict: "rejected",
      developerVerdict: "approved",
      secondAttempt: true,
      status: "CANCELLED",
    }), bucket, null);
    expect(state.attempt).toBe(2);
    expect(state.status).toBe("CANCELLED");
    expect(state.settlementReady).toBe(false);
  });

  it("fails closed when approved seats disagree on the document hash", () => {
    const state = deriveLawyerReviewState(listing({
      spvVerdict: "approved",
      spvDocumentsHash: "0xaaa",
      developerVerdict: "approved",
      developerDocumentsHash: "0xbbb",
      status: "LEGAL",
    }), bucket, settlement);
    expect(state.hashMismatch).toBe(true);
    expect(state.settlementReady).toBe(false);
  });

  it("marks a changed SPV seat stale and disables settlement", () => {
    const state = deriveLawyerReviewState(listing({
      spvLawyer: "ReplacementWallet",
      spvVerdict: "approved",
      developerVerdict: "approved",
      spvDocumentsHash: "0xabc",
      developerDocumentsHash: "0xabc",
      status: "LEGAL",
    }), bucket, settlement);
    expect(state.staleAssignment).toBe(true);
    expect(state.settlementReady).toBe(false);
  });

  it("marks a changed developer seat stale", () => {
    expect(deriveLawyerReviewState(listing({ developerLawyer: "ReplacementWallet" }), bucket, null).staleAssignment).toBe(true);
  });

  it("does not treat executeDeal evidence as ready for a non-Legal listing", () => {
    expect(deriveLawyerReviewState(listing(), bucket, settlement).settlementReady).toBe(false);
  });

  it("does not treat a Legal label with pending verdicts as settlement-ready", () => {
    const state = deriveLawyerReviewState(listing({ status: "LEGAL" }), bucket, settlement);

    expect(state.settlementReady).toBe(false);
  });

  it("disables settlement when execution evidence names a different lawyer seat", () => {
    const approved = listing({
      spvVerdict: "approved",
      spvDocumentsHash: "0xabc",
      developerVerdict: "approved",
      developerDocumentsHash: "0xabc",
      status: "LEGAL",
    });
    const state = deriveLawyerReviewState(approved, bucket, {
      ...settlement,
      developerLawyer: "ReplacementWallet",
    });

    expect(state.settlementReady).toBe(false);
  });

  it("flags a hash mismatch between any two decided seats, not only approvals", () => {
    const state = deriveLawyerReviewState(listing({
      spvVerdict: "rejected",
      spvDocumentsHash: "0xaaa",
      developerVerdict: "rejected",
      developerDocumentsHash: "0xbbb",
      status: "CANCELLED",
    }), bucket, null);

    expect(state.hashMismatch).toBe(true);
  });
});

describe("loadLawyerReviewState", () => {
  it("loads both seats and complete settlement evidence in one Indexer read", async () => {
    let request: { url: string; body: { query: string; variables: unknown } } | undefined;
    const fetcher = (async (url: unknown, init?: { body?: string }) => {
      request = { url: String(url), body: JSON.parse(init?.body ?? "{}") };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            listings: { nodes: [{
              listingId: "42",
              assetId: "42",
              spvLawyer: "SpvWallet",
              spvLawyerDocStatus: "APPROVED",
              spvLawyerDocumentsHash: "0xabc",
              developerLawyer: "DeveloperWallet",
              developerLawyerDocStatus: "APPROVED",
              developerLawyerDocumentsHash: "0xabc",
              secondAttempt: true,
              status: "LEGAL",
              legalDeadline: "1900000000",
            }] },
            pendingFinalizations: { executeDeal: settlement },
          },
        }),
      };
    }) as unknown as typeof fetch;

    const state = await loadLawyerReviewState(bucket, { fetcher });
    expect(state).toMatchObject({
      listingId: "42",
      assetId: "42",
      attempt: 2,
      status: "LEGAL",
      legalDeadline: 1_900_000_000,
      settlementReady: true,
      settlement,
    });
    expect(state?.spv).toEqual({ role: "spv", wallet: "SpvWallet", verdict: "approved", documentsHash: "0xabc" });
    expect(state?.developer).toEqual({ role: "developer", wallet: "DeveloperWallet", verdict: "approved", documentsHash: "0xabc" });
    expect(request?.url).toBe("https://indexer-devnet.xcavate.io/graphql");
    expect(request?.body.variables).toEqual({ listingId: "42", assetId: "42" });
    expect(request?.body.query).toContain("listings(listingId: $listingId, active: true, first: 1)");
    expect(request?.body.query).toContain("pendingFinalizations(assetId: $assetId, listingId: $listingId)");
  });

  it("returns null when no active listing exists", async () => {
    const state = await loadLawyerReviewState(bucket, {
      fetcher: stubFetcher({ data: { listings: { nodes: [] }, pendingFinalizations: { executeDeal: null } } }),
    });
    expect(state).toBeNull();
  });

  it("surfaces Indexer HTTP and GraphQL failures", async () => {
    await expect(loadLawyerReviewState(bucket, { fetcher: stubFetcher({}, 502) })).rejects.toThrow("Indexer HTTP 502");
    await expect(loadLawyerReviewState(bucket, {
      fetcher: stubFetcher({ errors: [{ message: "boom" }] }),
    })).rejects.toThrow("boom");
  });

  it("requires mainnet Indexer configuration rather than using devnet", async () => {
    await expect(loadLawyerReviewState({ ...bucket, cluster: "mainnet" }, {
      mainnetIndexerGraphqlUrl: "",
      fetcher: stubFetcher({ data: { listings: { nodes: [] } } }),
    })).rejects.toThrow("Mainnet Indexer GraphQL URL is not configured");
  });
});
