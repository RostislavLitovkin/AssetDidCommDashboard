/**
 * Minimal in-house Wallet Standard registry — no @wallet-standard/app
 * dependency. Wallets announce themselves by dispatching
 * `wallet-standard:register-wallet` with a callback as `detail`; the app
 * announces readiness by dispatching `wallet-standard:app-ready` with a
 * `{ register }` api as `detail`, which already-loaded wallets call back.
 */

export interface StandardWalletAccount {
  address: string
  publicKey?: Uint8Array
}

export interface StandardConnectFeature {
  connect(options?: { silent?: boolean }): Promise<{ accounts: readonly StandardWalletAccount[] }>
}

export interface SolanaSignMessageFeature {
  signMessage(input: {
    account: StandardWalletAccount
    message: Uint8Array
  }): Promise<readonly { signature: Uint8Array }[]>
}

export interface StandardWallet {
  name: string
  icon: string
  chains: readonly string[]
  features: Record<string, unknown>
}

const wallets: StandardWallet[] = []
let initialized = false

/** Only wallets we can actually connect and sign with are accepted. */
function isUsableSolanaWallet(wallet: StandardWallet): boolean {
  return (
    Boolean(wallet.features?.["standard:connect"]) &&
    Boolean(wallet.features?.["solana:signMessage"]) &&
    (wallet.chains ?? []).some((chain) => chain.startsWith("solana:"))
  )
}

function register(...newWallets: StandardWallet[]): () => void {
  for (const wallet of newWallets) {
    if (!isUsableSolanaWallet(wallet)) {
      continue
    }
    if (wallets.some((existing) => existing.name.toLowerCase() === wallet.name.toLowerCase())) {
      continue
    }
    wallets.push(wallet)
  }
  return () => {}
}

export function initSolanaWalletRegistry(): void {
  // Guards both SSR and node-environment tests whose window stubs lack the
  // event surface; initialized is only latched on the successful path so a
  // later call with a real window still attaches.
  if (initialized || typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return
  }
  initialized = true

  window.addEventListener("wallet-standard:register-wallet", (event) => {
    const callback = (event as unknown as { detail?: unknown }).detail
    if (typeof callback === "function") {
      callback({ register })
    }
  })
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register } }))
}

export function registeredSolanaWallets(): StandardWallet[] {
  initSolanaWalletRegistry()
  return [...wallets]
}

/** Test-only: clears collected wallets and re-arms init for a fresh window stub. */
export function resetSolanaWalletRegistry(): void {
  wallets.length = 0
  initialized = false
}
