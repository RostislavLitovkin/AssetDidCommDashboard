import type { WalletStatus } from "../types/operations"

export const useSessionStore = defineStore("session", {
  state: () => ({
    walletStatus: "disconnected" as WalletStatus,
    accountAddress: "",
    providerName: "",
    networkEndpoint: "wss://xcavate-paseo.api.onfinality.io/public-ws"
  }),
  actions: {
    setConnecting(): void {
      this.walletStatus = "connecting"
    },
    setConnected(accountAddress: string, providerName: string): void {
      this.walletStatus = "connected"
      this.accountAddress = accountAddress
      this.providerName = providerName
    },
    setRejected(): void {
      this.walletStatus = "rejected"
    },
    disconnect(): void {
      this.walletStatus = "disconnected"
      this.accountAddress = ""
      this.providerName = ""
    }
  }
})
