export type WalletKind = "solana" | "polkadot"

export interface WalletSession {
  address: string
  provider: string
  kind: WalletKind
}

export interface WalletAccountOption {
  address: string
  name: string
  source: string
}

/** A connectable wallet as shown in the picker; icon is the wallet-provided
 *  data: URI (absent for legacy injected wallets — the UI falls back to its
 *  own brand icons). */
export interface WalletInfo {
  name: string
  icon?: string
}

export interface WalletProvider {
  readonly kind: WalletKind
  listAccounts(): Promise<WalletAccountOption[]>
  connect(): Promise<WalletSession>
  connectToAddress(address: string): Promise<WalletSession>
  /** Silent reconnect on startup; never shows a popup. Returns null when unavailable. */
  autoConnect(stored: WalletSession | null): Promise<WalletSession | null>
  /**
   * Sign one API request. bodyHash is precomputed by the caller (hashApiBody
   * for JSON/raw bodies, "" for empty bodies) — identical for both schemes.
   */
  signApiRequest(address: string, method: string, path: string, bodyHash: string): Promise<HeadersInit>
  /** Optional (Solana only): discovered wallets; never triggers a connect popup. */
  listWallets?(): Promise<WalletInfo[]>
  /** Optional (Solana only): connect the named discovered wallet. */
  connectWith?(name: string): Promise<WalletSession>
}
