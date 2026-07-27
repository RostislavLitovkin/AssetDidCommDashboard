import { PolkadotWalletProvider } from "./polkadotProvider"
import { SolanaWalletProvider } from "./solanaProvider"
import type { WalletKind, WalletProvider } from "./types"

/** The only construction point for wallet providers. */
export function resolveWalletProvider(kind: WalletKind): WalletProvider {
  return kind === "polkadot" ? new PolkadotWalletProvider() : new SolanaWalletProvider()
}
