import { resolveWalletProvider } from "../services/wallet/resolveWalletProvider"
import { useSessionStore } from "../stores/session"
import { useSettingsStore } from "../stores/settings"
import { useOperationsStore } from "../stores/operations"
import type { WalletSession } from "../services/wallet/types"

export default defineNuxtPlugin(async () => {
  if (!import.meta.client) {
    return
  }

  const session = useSessionStore()
  const settings = useSettingsStore()
  const operations = useOperationsStore()
  settings.initialize()

  // A stored session's kind wins; sync the setting so the UI reflects reality.
  const stored: WalletSession | null = session.accountAddress
    ? { address: session.accountAddress, provider: session.providerName, kind: session.walletKind }
    : null
  const kind = stored?.kind ?? settings.walletType
  if (settings.walletType !== kind) {
    settings.setWalletType(kind)
  }

  const provider = resolveWalletProvider(kind)
  const restored = await provider.autoConnect(stored)

  if (restored) {
    session.setConnected(restored.address, restored.provider, restored.kind)
    operations.add("wallet", restored.address, "success", "Wallet auto-connected")
  } else {
    session.disconnect()
    operations.add("wallet", "session", "error", "Wallet unavailable")
  }
})
