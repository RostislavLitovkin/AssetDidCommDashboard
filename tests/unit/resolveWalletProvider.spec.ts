import { describe, expect, it, vi } from "vitest"

// The real @polkadot/extension-dapp bundle reads `window` at module-load time
// (`const win = window`), which crashes under Vitest's "node" environment even
// though this suite never calls a method that touches the extension. Mock it
// the same way tests/unit/useWallet.spec.ts does, so importing
// PolkadotWalletProvider only constructs an instance without loading the
// browser-only bundle.
vi.mock("@polkadot/extension-dapp", () => ({
  web3Accounts: vi.fn(),
  web3Enable: vi.fn(),
  web3FromAddress: vi.fn()
}))

import { resolveWalletProvider } from "../../app/services/wallet/resolveWalletProvider"
import { PolkadotWalletProvider } from "../../app/services/wallet/polkadotProvider"
import { SolanaWalletProvider } from "../../app/services/wallet/solanaProvider"

describe("resolveWalletProvider", () => {
  it("maps solana to the Solana provider", () => {
    const provider = resolveWalletProvider("solana")
    expect(provider).toBeInstanceOf(SolanaWalletProvider)
    expect(provider.kind).toBe("solana")
  })

  it("maps polkadot to the Polkadot provider", () => {
    const provider = resolveWalletProvider("polkadot")
    expect(provider).toBeInstanceOf(PolkadotWalletProvider)
    expect(provider.kind).toBe("polkadot")
  })
})
