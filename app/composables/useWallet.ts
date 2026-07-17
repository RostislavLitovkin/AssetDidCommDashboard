import { WalletExtensionProvider } from "../services/wallet/extensionProvider"

export function useWallet() {
  const store = useSessionStore()
  const operations = useOperationsStore()
  const provider = new WalletExtensionProvider()

  async function connect(): Promise<void> {
    try {
      store.setConnecting()
      const session = await provider.connect()
      store.setConnected(session.address, session.provider)
      operations.add("wallet", session.address, "success", "Wallet connected")
    } catch (error) {
      store.setRejected()
      operations.add("wallet", "connect", "error", error instanceof Error ? error.message : "Wallet connection failed")
    }
  }

  async function listAccounts(): Promise<Array<{ address: string; name: string; source: string }>> {
    return provider.listAccounts()
  }

  async function connectToAddress(address: string): Promise<void> {
    try {
      store.setConnecting()
      const session = await provider.connectToAddress(address)
      store.setConnected(session.address, session.provider)
      operations.add("wallet", session.address, "success", "Wallet switched")
    } catch (error) {
      store.setRejected()
      operations.add("wallet", "switch", "error", error instanceof Error ? error.message : "Wallet switch failed")
    }
  }

  function disconnect(): void {
    const previous = store.accountAddress
    store.disconnect()
    operations.add("wallet", previous || "session", "info", "Wallet disconnected")
  }

  async function signProfileRequest(
    method: "POST" | "PUT",
    path: string,
    body: string
  ): Promise<HeadersInit> {
    const address = store.accountAddress
    if (!address) {
      throw new Error("Connect a wallet before saving your profile")
    }

    return provider.signProfileRequest(address, method, path, body)
  }

  return {
    walletStatus: computed(() => store.walletStatus),
    accountAddress: computed(() => store.accountAddress),
    providerName: computed(() => store.providerName),
    connect,
    listAccounts,
    connectToAddress,
    signProfileRequest,
    disconnect
  }
}
