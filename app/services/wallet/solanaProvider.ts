import { composeApiSignaturePayload } from "./signingCore"
import type { WalletAccountOption, WalletProvider, WalletSession } from "./types"

/** The Phantom-style injected provider surface (also matched by Solflare/Backpack). */
interface SolanaInjectedProvider {
  publicKey?: { toBase58(): string } | null
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey?: { toBase58(): string } } | void>
  signMessage(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array } | Uint8Array>
}

interface DiscoveredWallet {
  provider: SolanaInjectedProvider
  name: string
}

function findInjectedWallet(): DiscoveredWallet | null {
  if (typeof window === "undefined") {
    return null
  }

  const w = window as unknown as {
    phantom?: { solana?: SolanaInjectedProvider }
    solflare?: SolanaInjectedProvider
    backpack?: SolanaInjectedProvider
  }

  if (w.phantom?.solana) return { provider: w.phantom.solana, name: "Phantom" }
  if (w.solflare) return { provider: w.solflare, name: "Solflare" }
  if (w.backpack) return { provider: w.backpack, name: "Backpack" }
  return null
}

function resolveAddress(
  wallet: DiscoveredWallet,
  connectResult: { publicKey?: { toBase58(): string } } | void
): string {
  // Phantom resolves connect() with the publicKey; Solflare resolves void and
  // sets .publicKey on the provider instead. Accept both.
  const key = connectResult?.publicKey ?? wallet.provider.publicKey
  const address = key?.toBase58()
  if (!address) {
    throw new Error("WALLET_CONNECTION_REJECTED")
  }
  return address
}

export class SolanaWalletProvider implements WalletProvider {
  readonly kind = "solana" as const

  private requireWallet(): DiscoveredWallet {
    const wallet = findInjectedWallet()
    if (!wallet) {
      throw new Error("WALLET_EXTENSION_UNAVAILABLE")
    }
    return wallet
  }

  async connect(): Promise<WalletSession> {
    const wallet = this.requireWallet()
    const result = await wallet.provider.connect()
    return { address: resolveAddress(wallet, result), provider: wallet.name, kind: this.kind }
  }

  /** Injected Solana wallets expose exactly one active account. */
  async listAccounts(): Promise<WalletAccountOption[]> {
    const session = await this.connect()
    return [{ address: session.address, name: session.provider, source: session.provider }]
  }

  async connectToAddress(_address: string): Promise<WalletSession> {
    // The wallet controls which account is active; connecting yields it.
    return this.connect()
  }

  /**
   * Silent reconnect via onlyIfTrusted (no popup). Retries while the wallet
   * script finishes injecting; a not-yet-trusted wallet resolves to null.
   */
  async autoConnect(stored: WalletSession | null, retries = 10): Promise<WalletSession | null> {
    const wallet = findInjectedWallet()

    if (wallet) {
      try {
        const result = await wallet.provider.connect({ onlyIfTrusted: true })
        return { address: resolveAddress(wallet, result), provider: wallet.name, kind: this.kind }
      } catch {
        return null
      }
    }

    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return this.autoConnect(stored, retries - 1)
    }
    return null
  }

  async signApiRequest(
    address: string,
    method: string,
    path: string,
    bodyHash: string
  ): Promise<HeadersInit> {
    const wallet = this.requireWallet()
    const { base58Encode } = await import("@polkadot/util-crypto")
    const { payload, timestamp } = composeApiSignaturePayload(method, path, bodyHash)

    // Solana signs the RAW payload bytes (never a hash of them) so the wallet
    // prompt shows readable text; the server verifies ed25519 over these bytes.
    const result = await wallet.provider.signMessage(new TextEncoder().encode(payload), "utf8")
    const signature = result instanceof Uint8Array ? result : result.signature

    return {
      "X-SS58-Address": address,
      "X-Signature": base58Encode(signature),
      "X-Timestamp": timestamp
    }
  }
}
