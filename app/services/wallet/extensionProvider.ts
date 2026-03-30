import { web3Accounts, web3Enable } from "@polkadot/extension-dapp"

export interface WalletSession {
  address: string
  provider: string
}

export interface WalletAccountOption {
  address: string
  name: string
  source: string
}

export class WalletExtensionProvider {
  private async ensureEnabled(): Promise<void> {
    const extensions = await web3Enable("Asset DIDComm Dashboard")
    if (!extensions.length) {
      throw new Error("WALLET_EXTENSION_UNAVAILABLE")
    }
  }

  async listAccounts(): Promise<WalletAccountOption[]> {
    await this.ensureEnabled()
    const accounts = await web3Accounts()
    return accounts.map((account) => ({
      address: account.address,
      name: account.meta.name || "Unnamed",
      source: account.meta.source || "unknown"
    }))
  }

  async connect(): Promise<WalletSession> {
    const accounts = await this.listAccounts()
    if (!accounts.length) {
      throw new Error("WALLET_CONNECTION_REJECTED")
    }

    return {
      address: accounts[0].address,
      provider: accounts[0].source
    }
  }

  async connectToAddress(address: string): Promise<WalletSession> {
    const accounts = await this.listAccounts()
    const selected = accounts.find((account) => account.address === address)
    if (!selected) {
      throw new Error("WALLET_ACCOUNT_NOT_FOUND")
    }

    return {
      address: selected.address,
      provider: selected.source
    }
  }
}
