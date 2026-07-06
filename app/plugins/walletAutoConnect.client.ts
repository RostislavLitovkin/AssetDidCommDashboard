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

  // Always attempt auto-connect on page load.
  // - Returning user: restores the previously connected address
  // - First-time user: connects to the first available account
  const storedSession = session.accountAddress
    ? { address: session.accountAddress, provider: session.providerName }
    : null

  try {
    const walletSession = await provider.autoConnect(storedSession)
    if (walletSession) {
      session.setConnected(walletSession.address, walletSession.provider)
      operations.add("wallet", walletSession.address, "success", "Wallet auto-connected")
    } else {
      // Extension unavailable or no accounts — reset stale session
      session.disconnect()
      operations.add("wallet", "session", "error", "Wallet extension unavailable")
    }
  } catch {
    // Auto-connect failed — reset stale session
    session.disconnect()
    operations.add("wallet", "session", "error", "Wallet connection failed")
  }
})