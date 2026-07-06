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

  // Wait for Polkadot.js extension to inject accounts, then auto-connect
  const connectWhenReady = async (): Promise<boolean> => {
    try {
      const accounts = await provider.listAccounts()
      if (!accounts.length) {
        return false
      }

      // Prefer the previously connected address, otherwise use the first account
      const targetAddress = session.accountAddress || accounts[0].address
      const walletSession = await provider.connectToAddress(targetAddress)

      session.setConnected(walletSession.address, walletSession.provider)
      operations.add("wallet", walletSession.address, "success", "Wallet auto-connected")
      return true
    } catch {
      return false
    }
  }

  // Poll until extension injects accounts (max 5 seconds)
  let connected = false
  for (let i = 0; i < 50 && !connected; i++) {
    connected = await connectWhenReady()
    if (!connected) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  if (!connected) {
    session.disconnect()
    operations.add("wallet", "session", "error", "Wallet extension unavailable")
  }
})