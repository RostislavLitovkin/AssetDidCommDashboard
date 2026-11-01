import type { SolanaCluster } from "./types";

export interface LegalClusterConfig {
  cluster: SolanaCluster;
  marketplaceProgramId: string;
  whitelistProgramId: string;
  regionsProgramId: string;
  tokenProgramId: string;
  associatedTokenProgramId: string;
  systemProgramId: string;
  rpcUrl: string;
  walletChain: "solana:devnet" | "solana:mainnet";
  indexerGraphqlUrl: string;
  explorerCluster: "devnet" | null;
}

export interface LegalClusterConfigOptions {
  mainnetIndexerGraphqlUrl?: string;
}

const PROGRAM_IDS = {
  marketplaceProgramId: "dj9Q3CpHvDHwexCbkgJ5APDx4JsTxPssNebkvP15g1T",
  whitelistProgramId: "7TrzjKpdrEhnfhxuw8tWdH1sjxadazscsG5HXCDPLmaY",
  regionsProgramId: "5iupkzVtWxee48UXh3s615V9sXXuYjsSr61VPuduXdPc",
  tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  associatedTokenProgramId: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  systemProgramId: "11111111111111111111111111111111",
} as const;

export function getLegalClusterConfig(
  cluster: SolanaCluster,
  options: LegalClusterConfigOptions = {},
): LegalClusterConfig {
  if (cluster === "devnet") {
    return {
      cluster,
      ...PROGRAM_IDS,
      rpcUrl: "https://api.devnet.solana.com",
      walletChain: "solana:devnet",
      indexerGraphqlUrl: "https://indexer-devnet.xcavate.io/graphql",
      explorerCluster: "devnet",
    };
  }

  const indexerGraphqlUrl = (
    options.mainnetIndexerGraphqlUrl ?? process.env.NUXT_PUBLIC_INDEXER_MAINNET_GRAPHQL_URL ?? ""
  ).trim();
  if (!indexerGraphqlUrl) {
    throw new Error("Mainnet Indexer GraphQL URL is not configured");
  }

  return {
    cluster,
    ...PROGRAM_IDS,
    rpcUrl: "https://api.mainnet-beta.solana.com",
    walletChain: "solana:mainnet",
    indexerGraphqlUrl,
    explorerCluster: null,
  };
}
