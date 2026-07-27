import type { WalletKind } from "./types"

export type WalletBrandId =
  | "phantom"
  | "solflare"
  | "backpack"
  | "polkadot-js"
  | "talisman"
  | "subwallet-js"

/**
 * The window surface the catalog inspects for installed wallets. Solana
 * wallets inject their own globals; polkadot.js-compatible extensions all
 * register under `injectedWeb3` keyed by extension id.
 */
export interface WalletDetectionHost {
  phantom?: { solana?: unknown }
  solflare?: unknown
  backpack?: unknown
  injectedWeb3?: Record<string, unknown>
}

export interface WalletCatalogEntry {
  id: WalletBrandId
  name: string
  kind: WalletKind
  downloadUrl: string
  isInstalled(host: WalletDetectionHost): boolean
}

export const WALLET_CATALOG: WalletCatalogEntry[] = [
  {
    id: "phantom",
    name: "Phantom",
    kind: "solana",
    downloadUrl: "https://phantom.com/download",
    isInstalled: (host) => Boolean(host.phantom?.solana)
  },
  {
    id: "solflare",
    name: "Solflare",
    kind: "solana",
    downloadUrl: "https://solflare.com/download",
    isInstalled: (host) => Boolean(host.solflare)
  },
  {
    id: "backpack",
    name: "Backpack",
    kind: "solana",
    downloadUrl: "https://backpack.app/download",
    isInstalled: (host) => Boolean(host.backpack)
  },
  {
    id: "polkadot-js",
    name: "polkadot.js",
    kind: "polkadot",
    downloadUrl: "https://polkadot.js.org/extension/",
    isInstalled: (host) => Boolean(host.injectedWeb3?.["polkadot-js"])
  },
  {
    id: "talisman",
    name: "Talisman",
    kind: "polkadot",
    downloadUrl: "https://talisman.xyz/download",
    isInstalled: (host) => Boolean(host.injectedWeb3?.["talisman"])
  },
  {
    id: "subwallet-js",
    name: "SubWallet",
    kind: "polkadot",
    downloadUrl: "https://www.subwallet.app/download.html",
    isInstalled: (host) => Boolean(host.injectedWeb3?.["subwallet-js"])
  }
]

function detectionHost(): WalletDetectionHost {
  return typeof window === "undefined" ? {} : (window as unknown as WalletDetectionHost)
}

export function walletsForKind(kind: WalletKind): WalletCatalogEntry[] {
  return WALLET_CATALOG.filter((entry) => entry.kind === kind)
}

/** Ids of the catalog wallets currently injected into this browser. */
export function detectInstalledWallets(kind: WalletKind, host: WalletDetectionHost = detectionHost()): Set<WalletBrandId> {
  return new Set(
    walletsForKind(kind)
      .filter((entry) => entry.isInstalled(host))
      .map((entry) => entry.id)
  )
}

/**
 * True when at least one known wallet of the kind is injected. For Polkadot
 * any `injectedWeb3` entry counts — unknown polkadot.js-compatible
 * extensions still work with the provider.
 */
export function hasInstalledWallet(kind: WalletKind, host: WalletDetectionHost = detectionHost()): boolean {
  if (kind === "polkadot" && Object.keys(host.injectedWeb3 ?? {}).length > 0) {
    return true
  }
  return detectInstalledWallets(kind, host).size > 0
}
