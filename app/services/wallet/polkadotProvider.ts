import { web3Accounts, web3Enable, web3FromAddress } from "@polkadot/extension-dapp"
import { composeApiSignaturePayload } from "./signingCore"
import type { WalletAccountOption, WalletProvider, WalletSession } from "./types"

export class PolkadotWalletProvider implements WalletProvider {
  readonly kind = "polkadot" as const

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
    return { address: account.address, provider: account.source, kind: this.kind }
  }

  async connectToAddress(address: string): Promise<WalletSession> {
    const accounts = await this.listAccounts()
    const selected = accounts.find((account) => account.address === address)
    if (!selected) {
      throw new Error("WALLET_ACCOUNT_NOT_FOUND")
    }
    return { address: selected.address, provider: selected.source, kind: this.kind }
  }

  /**
   * Silent reconnect: restore the stored address or fall back to the first
   * account. Retries while the extension finishes injecting (~5s max, matching
   * the old plugin-level polling).
   */
  async autoConnect(stored: WalletSession | null, retries = 10): Promise<WalletSession | null> {
    let extensions: Awaited<ReturnType<typeof web3Enable>>
    try {
      extensions = await web3Enable("realXmessage Dashboard")
    } catch {
      extensions = []
    }

    if (extensions.length) {
      if (stored?.address) {
        try {
          return await this.connectToAddress(stored.address)
        } catch {
          // Address no longer available — fall through to first account
        }
      }

      try {
        const [account] = await this.listAccounts()
        if (account) {
          return { address: account.address, provider: account.source, kind: this.kind }
        }
      } catch {
        // fall through to retry
      }
    }

    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return this.autoConnect(stored, retries - 1)
    }
    return null
  }

  async signApiRequest(
    address: string,
    method: string,
    path: string,
    bodyHash: string
  ): Promise<HeadersInit> {
    await this.ensureEnabled()
    const { blake2AsHex, cryptoWaitReady } = await import("@polkadot/util-crypto")
    await cryptoWaitReady()

    const injector = await web3FromAddress(address)
    if (!injector.signer.signRaw) {
      throw new Error("WALLET_SIGNING_UNAVAILABLE")
    }

    const { payload, timestamp } = composeApiSignaturePayload(method, path, bodyHash)

    // The extension wraps signRaw bytes in <Bytes>...</Bytes>, which is the
    // validator's fallback branch. sr25519 signs the blake2-128 of the payload.
    const signed = await injector.signer.signRaw({
      address,
      data: blake2AsHex(payload, 128),
      type: "bytes"
    })

    return {
      "X-SS58-Address": address,
      "X-Signature": signed.signature,
      "X-Timestamp": timestamp
    }
  }
}
