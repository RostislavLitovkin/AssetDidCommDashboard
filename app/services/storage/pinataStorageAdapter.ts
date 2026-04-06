export interface StorageAdapter {
  upload(data: Uint8Array | string): Promise<string>
  download(identifier: string): Promise<Uint8Array>
}

interface PinataAdapterOptions {
  uploadEndpoint?: string
  publicGateway?: string
  network?: "public" | "private"
  jwt?: string
  apiKey?: string
  apiSecret?: string
}

export class PinataStorageAdapter implements StorageAdapter {
  private options: Required<Omit<PinataAdapterOptions, "jwt" | "apiKey" | "apiSecret">> & {
    jwt?: string
    apiKey?: string
    apiSecret?: string
  }

  constructor(options?: PinataAdapterOptions) {
    this.options = {
      uploadEndpoint: options?.uploadEndpoint ?? "https://uploads.pinata.cloud/v3/files",
      publicGateway: options?.publicGateway ?? "https://gateway.pinata.cloud/ipfs",
      network: options?.network ?? "public",
      jwt: options?.jwt?.trim(),
      apiKey: options?.apiKey?.trim(),
      apiSecret: options?.apiSecret?.trim()
    }

    const hasJwt = Boolean(this.options.jwt)
    const hasApiPair = Boolean(this.options.apiKey && this.options.apiSecret)
    if (!hasJwt && !hasApiPair) {
      throw new Error("Pinata credentials are missing. Set NUXT_PUBLIC_PINATA_JWT or NUXT_PUBLIC_PINATA_API_KEY + NUXT_PUBLIC_PINATA_API_SECRET.")
    }
  }

  public async upload(data: Uint8Array | string): Promise<string> {
    console.log("PinataAdapter: Starting upload process...")

    const dataToUpload = typeof data === "string" ? new TextEncoder().encode(data) : data
    const normalizedBuffer = new ArrayBuffer(dataToUpload.byteLength)
    new Uint8Array(normalizedBuffer).set(dataToUpload)

    const blob = new Blob([normalizedBuffer])
    const formData = new FormData()
    formData.append("file", blob, "assetdidcomm-message.jwe")
    // Explicitly set public network so the CID is retrievable by anyone with the CID.
    formData.append("network", this.options.network)

    const response = await fetch(this.options.uploadEndpoint, {
      method: "POST",
      headers: this.createAuthHeaders(),
      body: formData
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Pinata upload failed with status ${response.status}: ${errorText}`)
    }

    const payload = await response.json() as { cid?: string; data?: { cid?: string } }
    const cid = payload.cid ?? payload.data?.cid
    if (!cid) {
      throw new Error("Pinata V3 upload response did not contain 'cid'.")
    }

    console.log(`PinataAdapter: Upload successful. CID: ${cid}`)
    return cid
  }

  public async download(identifier: string): Promise<Uint8Array> {
    const trimmed = identifier.trim()
    const url = `${this.options.publicGateway}/${trimmed}`
    console.log(`PinataAdapter: Downloading from ${url}`)

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Pinata download failed with status ${response.status}`)
    }

    const data = await response.arrayBuffer()
    return new Uint8Array(data)
  }

  private createAuthHeaders(): Record<string, string> {
    if (this.options.jwt) {
      return {
        Authorization: `Bearer ${this.options.jwt}`
      }
    }

    // JWT is preferred for Pinata V3; key/secret is retained for compatibility.
    return {
      pinata_api_key: this.options.apiKey as string,
      pinata_secret_api_key: this.options.apiSecret as string
    }
  }
}
