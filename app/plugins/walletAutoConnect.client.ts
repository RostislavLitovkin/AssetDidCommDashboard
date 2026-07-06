import { WalletExtensionProvider } from "../services/wallet/extensionProvider"
import { useSessionStore } from "../stores/session"
import { useOperationsStore } from "../stores/operations"

export default defineNuxtPlugin(async () => {
  if (!import.meta.client) {
    return
  }

  const provider = new WalletExtensionProvider()
  const session = useSessionStore()
  const operations = useOperationsStore()

  // Only auto-connect when the wallet is not already connected
  if (session.walletStatus !== "connected") {
    const storedSession = session.accountAddress
      ? { address: session.accountAddress, provider: session.providerName }
      : null

    try {
      const walletSession = await provider.autoConnect(storedSession)
      if (walletSession) {
        session.setConnected(walletSession.address, walletSession.provider)
        operations.add("wallet", walletSession.address, "success", "Wallet auto-connected")
      }
    } catch {
      // Auto-connect failed silently — user can still connect manually
    }
  }
})