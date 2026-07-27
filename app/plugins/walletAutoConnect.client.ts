import { resolveWalletProvider } from "../services/wallet/resolveWalletProvider"
import { useSessionStore } from "../stores/session"
import { useSettingsStore } from "../stores/settings"
import { useOperationsStore } from "../stores/operations"
import type { WalletSession } from "../services/wallet/types"

export default defineNuxtPlugin(() => {
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

  // Never block app boot on wallet startup: web3Enable can hang indefinitely
  // while an extension authorization prompt is pending. The session store
  // already restored any persisted session optimistically, so autoConnect
  // only reconciles it in the background.
  const provider = resolveWalletProvider(kind)
  provider
    .autoConnect(stored)
    .catch(() => null)
    .then((restored) => {
      if (restored) {
        session.setConnected(restored.address, restored.provider, restored.kind)
        operations.add("wallet", restored.address, "success", "Wallet auto-connected")
      } else {
        session.disconnect()
        operations.add("wallet", "session", "error", "Wallet unavailable")
      }
    })
})
