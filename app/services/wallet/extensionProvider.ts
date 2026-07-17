import { web3Accounts, web3Enable, web3FromAddress } from "@polkadot/extension-dapp"

export interface WalletSession {
  address: string
  provider: string
}

export interface WalletAccountOption {
  address: string
  name: string
  source: string
}

// Map property names to match C# Profile serialization
// C# uses JsonNamingPolicy.CamelCase with specific JsonPropertyName attributes:
// - Ss58Address -> "ss58address" (not "ss58Address")
// - Nickname -> "nickname"
// - Bio -> "bio"
// - ProfilePicture -> "profilePicture"
// - X25519Key -> "x25519Key"
function toCSharpPropertyNames(json: string): string {
  // Replace "ss58Address" with "ss58address"
  return json.replace('"ss58Address":', '"ss58address":')
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
    const [account] = await this.listAccounts()
    if (!account) {
      throw new Error("WALLET_CONNECTION_REJECTED")
    }

    return {
      address: account.address,
      provider: account.source
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

  async signProfileRequest(
    address: string,
    method: "POST" | "PUT",
    path: string,
    body: string
  ): Promise<HeadersInit> {
    await this.ensureEnabled()
    const { blake2AsHex, cryptoWaitReady } = await import("@polkadot/util-crypto")
    await cryptoWaitReady()

    const injector = await web3FromAddress(address)
    if (!injector.signer.signRaw) {
      throw new Error("WALLET_SIGNING_UNAVAILABLE")
    }

    const timestamp = new Date().toISOString()
    // Hash the JSON with C#-style property names to match Profile.Hash() implementation
    const bodyHash = blake2AsHex(toCSharpPropertyNames(body), 128).slice(2)
    const payload = `${method}:${path}:${bodyHash}:${timestamp}`
    const payloadHash = blake2AsHex(payload, 128)
    const signed = await injector.signer.signRaw({
      address,
      data: payloadHash,
      type: "bytes"
    })

    return {
      "X-SS58-Address": address,
      "X-Signature": signed.signature,
      "X-Timestamp": timestamp
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
    const [account] = await this.listAccounts()
    if (!account) {
      return null
    }

    return {
      address: account.address,
      provider: account.source
    }
  }
}
