import { describe, expect, it } from "vitest";
import { getLegalClusterConfig } from "../../app/services/lawyer/cluster";
import { parseLawyerReviewBucket } from "../../app/services/lawyer/reviewBucket";

const baseProperties = {
  kind: "lawyer_document_review",
  property_id: "42",
  listing_id: "42",
  cluster: "devnet",
  spv_lawyer: "SpvWallet",
  developer_lawyer: "DeveloperWallet",
  listing: "ListingPda",
  property: "PropertyPda",
};

describe("legal cluster configuration", () => {
  it("keeps devnet programs, RPC, wallet chain, Indexer, and explorer on devnet", () => {
    expect(getLegalClusterConfig("devnet")).toEqual({
      cluster: "devnet",
      marketplaceProgramId: "dj9Q3CpHvDHwexCbkgJ5APDx4JsTxPssNebkvP15g1T",
      whitelistProgramId: "7TrzjKpdrEhnfhxuw8tWdH1sjxadazscsG5HXCDPLmaY",
      regionsProgramId: "5iupkzVtWxee48UXh3s615V9sXXuYjsSr61VPuduXdPc",
      tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      associatedTokenProgramId: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      systemProgramId: "11111111111111111111111111111111",
      rpcUrl: "https://api.devnet.solana.com",
      walletChain: "solana:devnet",
      indexerGraphqlUrl: "https://indexer-devnet.xcavate.io/graphql",
      explorerCluster: "devnet",
    });
  });

  it("uses explicit mainnet Indexer configuration and mainnet wallet/RPC/explorer values", () => {
    const config = getLegalClusterConfig("mainnet", {
      mainnetIndexerGraphqlUrl: "https://indexer-mainnet.example/graphql",
    });
    expect(config).toMatchObject({
      cluster: "mainnet",
      rpcUrl: "https://api.mainnet-beta.solana.com",
      walletChain: "solana:mainnet",
      indexerGraphqlUrl: "https://indexer-mainnet.example/graphql",
      explorerCluster: null,
    });
    expect(config.marketplaceProgramId).toBe("dj9Q3CpHvDHwexCbkgJ5APDx4JsTxPssNebkvP15g1T");
    expect(config.whitelistProgramId).toBe("7TrzjKpdrEhnfhxuw8tWdH1sjxadazscsG5HXCDPLmaY");
    expect(config.regionsProgramId).toBe("5iupkzVtWxee48UXh3s615V9sXXuYjsSr61VPuduXdPc");
  });

  it("fails closed instead of routing mainnet to the devnet Indexer", () => {
    expect(() => getLegalClusterConfig("mainnet", { mainnetIndexerGraphqlUrl: "" })).toThrow(
      "Mainnet Indexer GraphQL URL is not configured",
    );
  });
});

describe("parseLawyerReviewBucket", () => {
  it("parses property, cluster, lawyers, and PDA metadata", () => {
    expect(parseLawyerReviewBucket({ category: "lawyer-document-review", properties: JSON.stringify(baseProperties) })).toEqual({
      propertyId: "42",
      cluster: "devnet",
      spvLawyer: "SpvWallet",
      developerLawyer: "DeveloperWallet",
      listingPda: "ListingPda",
      propertyPda: "PropertyPda",
    });
  });

  it("accepts the API key/value property array and unwraps stringified values", () => {
    const properties = JSON.stringify([
      { key: "property_id", value: "42" },
      { key: "cluster", value: '"mainnet"' },
      { key: "spv_lawyer", value: "SpvWallet" },
      { key: "developer_lawyer", value: "DeveloperWallet" },
      { key: "listing", value: "ListingPda" },
      { key: "property", value: "PropertyPda" },
    ]);
    expect(parseLawyerReviewBucket({ category: "lawyer-document-review", properties })).toMatchObject({
      propertyId: "42",
      cluster: "mainnet",
    });
  });

  it("prefers property_id over listing_id", () => {
    expect(parseLawyerReviewBucket({
      category: "lawyer-document-review",
      properties: JSON.stringify({ ...baseProperties, property_id: "43", listing_id: "42" }),
    })).toBeUndefined();
    expect(parseLawyerReviewBucket({
      category: "lawyer-document-review",
      properties: JSON.stringify({ ...baseProperties, property_id: "43", listing_id: undefined }),
    })?.propertyId).toBe("43");
  });

  it("uses listing_id only for legacy buckets", () => {
    const legacy = { ...baseProperties, property_id: undefined, cluster: undefined };
    expect(parseLawyerReviewBucket({
      category: "lawyer-document-review",
      properties: JSON.stringify(legacy),
    }, { legacyCluster: "devnet" })).toMatchObject({ propertyId: "42", cluster: "devnet" });
  });

  it("does not guess a cluster for legacy metadata", () => {
    const legacy = { ...baseProperties, cluster: undefined };
    expect(parseLawyerReviewBucket({ category: "lawyer-document-review", properties: JSON.stringify(legacy) })).toBeUndefined();
  });

  it("rejects cluster/property mismatches, wrong categories, and malformed metadata", () => {
    expect(parseLawyerReviewBucket({
      category: "lawyer-document-review",
      properties: JSON.stringify({ ...baseProperties, cluster: "testnet" }),
    })).toBeUndefined();
    expect(parseLawyerReviewBucket({ category: "realXmarket", properties: JSON.stringify(baseProperties) })).toBeUndefined();
    expect(parseLawyerReviewBucket({ category: "lawyer-document-review", properties: "not json" })).toBeUndefined();
    expect(parseLawyerReviewBucket({
      category: "lawyer-document-review",
      properties: JSON.stringify({ ...baseProperties, spv_lawyer: "" }),
    })).toBeUndefined();
  });
});
