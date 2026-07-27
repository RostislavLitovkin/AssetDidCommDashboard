import type { WalletStatus } from "../types/operations"
import type { WalletKind } from "../services/wallet/types"

const WALLET_SESSION_KEY = "rxm.walletSession"

type StoredWalletSession = {
  address: string
  provider: string
  kind: WalletKind
}

function loadStoredSession(): StoredWalletSession | null {
  if (!import.meta.client) {
    return null
  }

  try {
    const raw = localStorage.getItem(WALLET_SESSION_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<StoredWalletSession> | null
    if (!parsed || typeof parsed.address !== "string" || typeof parsed.provider !== "string" || !parsed.address) {
      return null
    }

    // Legacy sessions predate the `kind` field and were only ever written by
    // the Polkadot extension provider.
    const kind: WalletKind = parsed.kind === "solana" ? "solana" : "polkadot"
    return { address: parsed.address, provider: parsed.provider, kind }
  } catch {
    return null
  }
}

function persistSession(address: string, provider: string, kind: WalletKind): void {
  if (!import.meta.client) {
    return
  }

  const payload: StoredWalletSession = { address, provider, kind }
  localStorage.setItem(WALLET_SESSION_KEY, JSON.stringify(payload))
}

function clearSession(): void {
  if (!import.meta.client) {
    return
  }

  localStorage.removeItem(WALLET_SESSION_KEY)
}

export const useSessionStore = defineStore("session", {
  state: () => {
    const stored = loadStoredSession()

    return {
      walletStatus: (stored ? "connected" : "disconnected") as WalletStatus,
      accountAddress: stored?.address ?? "",
      providerName: stored?.provider ?? "",
      walletKind: (stored?.kind ?? "polkadot") as WalletKind,
      networkEndpoint: "wss://xcavate-solochain.api.onfinality.io/public-ws"
    }
  },
  actions: {
    setConnecting(): void {
      this.walletStatus = "connecting"
    },
    setConnected(accountAddress: string, providerName: string, kind: WalletKind): void {
      this.walletStatus = "connected"
      this.accountAddress = accountAddress
      this.providerName = providerName
      this.walletKind = kind
      persistSession(accountAddress, providerName, kind)
    },
    setRejected(): void {
      this.walletStatus = "rejected"
    },
    disconnect(): void {
      this.walletStatus = "disconnected"
      this.accountAddress = ""
      this.providerName = ""
      clearSession()
    }
  }
})
