import { composeApiSignaturePayload } from "./signingCore"
import { registeredSolanaWallets } from "./solanaWalletRegistry"
import type {
  SolanaSignMessageFeature,
  StandardConnectFeature,
  StandardWallet,
  StandardWalletAccount
} from "./solanaWalletRegistry"
import type { WalletAccountOption, WalletInfo, WalletProvider, WalletSession } from "./types"

/** The Phantom-style injected provider surface (also matched by Solflare/Backpack). */
interface SolanaInjectedProvider {
  publicKey?: { toBase58(): string } | null
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey?: { toBase58(): string } } | void>
  signMessage(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array } | Uint8Array>
}

/** A connectable Solana wallet, whichever protocol it was discovered over. */
interface DiscoveredWallet {
  name: string
  icon?: string
  /** Active base58 address when known without connecting; null otherwise. */
  activeAddress(): string | null
  /** Resolves the active address; silent never shows a popup. */
  connect(options?: { silent?: boolean }): Promise<string>
  signMessage(message: Uint8Array): Promise<Uint8Array>
}

function legacyWallet(provider: SolanaInjectedProvider, name: string): DiscoveredWallet {
  return {
    name,
    activeAddress: () => provider.publicKey?.toBase58() ?? null,
    async connect(options) {
      const result = await provider.connect(options?.silent ? { onlyIfTrusted: true } : undefined)
      // Phantom resolves connect() with the publicKey; Solflare resolves void
      // and sets .publicKey on the provider instead. Accept both.
      const key = result?.publicKey ?? provider.publicKey
      const address = key?.toBase58()
      if (!address) {
        throw new Error("WALLET_CONNECTION_REJECTED")
      }
      return address
    },
    async signMessage(message) {
      const result = await provider.signMessage(message, "utf8")
      return result instanceof Uint8Array ? result : result.signature
    }
  }
}

// Adapters cache the connected account, so they must survive re-discovery;
// keyed by the wallet object the registry holds.
const standardAdapters = new WeakMap<StandardWallet, DiscoveredWallet>()

function standardWallet(wallet: StandardWallet): DiscoveredWallet {
  const existing = standardAdapters.get(wallet)
  if (existing) {
    return existing
  }

  const connectFeature = wallet.features["standard:connect"] as StandardConnectFeature
  const signFeature = wallet.features["solana:signMessage"] as SolanaSignMessageFeature
  let account: StandardWalletAccount | null = null

  const connect = async (options?: { silent?: boolean }): Promise<string> => {
    const { accounts } = await connectFeature.connect(options?.silent ? { silent: true } : undefined)
    const first = accounts[0]
    if (!first) {
      throw new Error("WALLET_CONNECTION_REJECTED")
    }
    account = first
    return first.address
  }

  const adapter: DiscoveredWallet = {
    name: wallet.name,
    icon: wallet.icon,
    activeAddress: () => account?.address ?? null,
    connect,
    async signMessage(message) {
      if (!account) {
        // Signing already prompts, so a connect popup here is acceptable.
        await connect()
      }
      const [result] = await signFeature.signMessage({ account: account!, message })
      if (!result) {
        throw new Error("WALLET_CONNECTION_REJECTED")
      }
      return result.signature
    }
  }
  standardAdapters.set(wallet, adapter)
  return adapter
}

/** Legacy globals rank first; registry wallets are deduped by name. */
function discoverWallets(): DiscoveredWallet[] {
  if (typeof window === "undefined") {
    return []
  }

  const w = window as unknown as {
    phantom?: { solana?: SolanaInjectedProvider }
    solflare?: SolanaInjectedProvider
    backpack?: SolanaInjectedProvider
  }

  const found: DiscoveredWallet[] = []
  if (w.phantom?.solana) found.push(legacyWallet(w.phantom.solana, "Phantom"))
  if (w.solflare) found.push(legacyWallet(w.solflare, "Solflare"))
  if (w.backpack) found.push(legacyWallet(w.backpack, "Backpack"))

  for (const wallet of registeredSolanaWallets()) {
    if (!found.some((existing) => existing.name.toLowerCase() === wallet.name.toLowerCase())) {
      found.push(standardWallet(wallet))
    }
  }
  return found
}

export class SolanaWalletProvider implements WalletProvider {
  readonly kind = "solana" as const

  async listWallets(): Promise<WalletInfo[]> {
    return discoverWallets().map(({ name, icon }) => ({ name, icon }))
  }

  async connectWith(name: string): Promise<WalletSession> {
    const wallet = discoverWallets().find((candidate) => candidate.name === name)
    if (!wallet) {
      throw new Error("WALLET_EXTENSION_UNAVAILABLE")
    }
    const address = await wallet.connect()
    return { address, provider: wallet.name, kind: this.kind }
  }

  async connect(): Promise<WalletSession> {
    const [wallet] = discoverWallets()
    if (!wallet) {
      throw new Error("WALLET_EXTENSION_UNAVAILABLE")
    }
    const address = await wallet.connect()
    return { address, provider: wallet.name, kind: this.kind }
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
   * Silent reconnect (no popup), preferring the stored session's wallet, then
   * the remaining discovered wallets in order. Retries while wallet scripts
   * finish injecting; a not-yet-trusted wallet just falls through.
   */
  async autoConnect(stored: WalletSession | null, retries = 10): Promise<WalletSession | null> {
    const wallets = discoverWallets()

    if (wallets.length > 0) {
      const preferred = wallets.filter((wallet) => wallet.name === stored?.provider)
      const rest = wallets.filter((wallet) => !preferred.includes(wallet))
      for (const wallet of [...preferred, ...rest]) {
        try {
          const address = await wallet.connect({ silent: true })
          return { address, provider: wallet.name, kind: this.kind }
        } catch {
          // Not trusted (yet) — try the next wallet.
        }
      }
      return null
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
    const wallets = discoverWallets()
    if (wallets.length === 0) {
      throw new Error("WALLET_EXTENSION_UNAVAILABLE")
    }

    // The wallet holding the session's account signs; when no wallet exposes
    // an active address yet, fall back to the first and let it connect.
    const wallet = wallets.find((candidate) => candidate.activeAddress() === address) ?? wallets[0]!
    const activeAddress = wallet.activeAddress()
    if (activeAddress && activeAddress !== address) {
      throw new Error("WALLET_ACCOUNT_NOT_FOUND")
    }

    const { base58Encode } = await import("@polkadot/util-crypto")
    const { payload, timestamp } = composeApiSignaturePayload(method, path, bodyHash)

    // Solana signs the RAW payload bytes (never a hash of them) so the wallet
    // prompt shows readable text; the server verifies ed25519 over these bytes.
    const signature = await wallet.signMessage(new TextEncoder().encode(payload))

    return {
      "X-SS58-Address": address,
      "X-Signature": base58Encode(signature),
      "X-Timestamp": timestamp
    }
  }
}
