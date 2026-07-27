import { describe, expect, it } from "vitest"

import {
  WALLET_CATALOG,
  detectInstalledWallets,
  hasInstalledWallet,
  walletsForKind
} from "../../app/services/wallet/walletCatalog"

describe("walletCatalog", () => {
  it("lists three wallets per kind", () => {
    expect(walletsForKind("solana").map((entry) => entry.id)).toEqual(["phantom", "solflare", "backpack"])
    expect(walletsForKind("polkadot").map((entry) => entry.id)).toEqual(["polkadot-js", "talisman", "subwallet-js"])
  })

  it("every entry has an https download url", () => {
    for (const entry of WALLET_CATALOG) {
      expect(entry.downloadUrl).toMatch(/^https:\/\//)
    }
  })

  it("detects injected Solana wallets by their globals", () => {
    expect(detectInstalledWallets("solana", {})).toEqual(new Set())
    expect(detectInstalledWallets("solana", { phantom: { solana: {} } })).toEqual(new Set(["phantom"]))
    expect(detectInstalledWallets("solana", { solflare: {}, backpack: {} })).toEqual(new Set(["solflare", "backpack"]))
  })

  it("does not detect Phantom from an empty phantom namespace", () => {
    expect(detectInstalledWallets("solana", { phantom: {} })).toEqual(new Set())
  })

  it("detects polkadot.js-compatible extensions via injectedWeb3 keys", () => {
    expect(detectInstalledWallets("polkadot", {})).toEqual(new Set())
    expect(
      detectInstalledWallets("polkadot", { injectedWeb3: { "polkadot-js": {}, "subwallet-js": {} } })
    ).toEqual(new Set(["polkadot-js", "subwallet-js"]))
    expect(detectInstalledWallets("polkadot", { injectedWeb3: { talisman: {} } })).toEqual(new Set(["talisman"]))
  })

  it("ignores wallets of the other kind during detection", () => {
    expect(detectInstalledWallets("polkadot", { phantom: { solana: {} } })).toEqual(new Set())
    expect(detectInstalledWallets("solana", { injectedWeb3: { talisman: {} } })).toEqual(new Set())
  })

  it("hasInstalledWallet counts unknown injectedWeb3 extensions for polkadot", () => {
    expect(hasInstalledWallet("polkadot", { injectedWeb3: { "nova-wallet": {} } })).toBe(true)
    expect(hasInstalledWallet("polkadot", { injectedWeb3: {} })).toBe(false)
    expect(hasInstalledWallet("solana", { solflare: {} })).toBe(true)
    expect(hasInstalledWallet("solana", {})).toBe(false)
  })
})
