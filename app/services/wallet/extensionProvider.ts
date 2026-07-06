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
    const extensions = await web3Enable("realXmessage Dashboard")
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

  /**
   * Auto-connect: restore the previously connected address from storedSession,
   * or fall back to the first available account. Never shows a popup.
   * Retries with a short delay if the extension hasn't finished injecting yet.
   */
  async autoConnect(storedSession: { address: string; provider: string } | null, retries = 3): Promise<WalletSession | null> {
    let extensions: Awaited<ReturnType<typeof web3Enable>>

    try {
      extensions = await web3Enable("realXmessage Dashboard")
    } catch {
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        return this.autoConnect(storedSession, retries - 1)
      }
      return null
    }

    if (!extensions.length) {
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        return this.autoConnect(storedSession, retries - 1)
      }
      return null
    }

    // 1) Try to restore the previously connected address
    if (storedSession && storedSession.address) {
      try {
        return await this.connectToAddress(storedSession.address)
      } catch {
        // Address no longer available — fall through to first account
      }
    }

    // 2) Fall back to the first available account
    const options = await this.listAccounts()
    if (!options.length) {
      return null
    }

    return {
      address: options[0].address,
      provider: options[0].source
    }
  }
}
