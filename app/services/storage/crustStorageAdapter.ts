export interface SignRawResult {
  signature: string
}

export interface SignRawPayload {
  type: "bytes"
  address: string
  data: string
}

export interface Signer {
  signRaw(payload: SignRawPayload): Promise<SignRawResult>
}

export interface StorageAdapter {
  upload(data: Uint8Array | string): Promise<string>
  download(identifier: string): Promise<Uint8Array>
}

interface CrustAdapterOptions {
  uploadGateway?: string
  pinningEndpoint?: string
  publicGateway?: string
}

export class CrustStorageAdapter implements StorageAdapter {
  private signer: Signer
  private address: string
  private options: Required<CrustAdapterOptions>

  constructor(address: string, signer: Signer, options?: CrustAdapterOptions) {
    if (!address?.trim()) {
      throw new Error("A signer address is required for CrustStorageAdapter.")
    }
    if (!signer) {
      throw new Error("A Signer is required for CrustStorageAdapter.")
    }

    this.address = address.trim()
    this.signer = signer
    this.options = {
      uploadGateway: options?.uploadGateway ?? "https://crustipfs.xyz/api/v0/add",
      pinningEndpoint: options?.pinningEndpoint ?? "https://pin.crustcode.com/psa/pins",
      publicGateway: options?.publicGateway ?? "https://crustipfs.io/ipfs"
    }
  }

  public async upload(data: Uint8Array | string): Promise<string> {
    console.log("CrustAdapter: Starting upload and pin process...")

    const dataToUpload = typeof data === "string" ? new TextEncoder().encode(data) : data
    const authHeader = await this.createAuthHeader()

    const normalizedBuffer = new ArrayBuffer(dataToUpload.byteLength)
    new Uint8Array(normalizedBuffer).set(dataToUpload)
    const dataBlob = new Blob([normalizedBuffer])
    const formData = new FormData()
    formData.append("file", dataBlob, "assetdidcomm-message.jwe")

    const uploadResponse = await fetch(this.options.uploadGateway, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`
      },
      body: formData
    })

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      throw new Error(`Crust upload failed with status ${uploadResponse.status}: ${errorText}`)
    }

    const uploadResult = await uploadResponse.json() as { Hash?: string }
    const cid = uploadResult.Hash
    if (!cid) {
      throw new Error("Crust upload response did not contain a 'Hash' (CID).")
    }

    console.log(`CrustAdapter: Successfully uploaded. CID: ${cid}`)
    console.log(`CrustAdapter: Pinning CID ${cid}...`)
    await this.pinToCrust(cid, authHeader)
    console.log("CrustAdapter: Pinning successful.")

    return cid
  }

  public async download(identifier: string): Promise<Uint8Array> {
    const downloadUrl = `${this.options.publicGateway}/${identifier}`
    console.log(`CrustAdapter: Downloading from ${downloadUrl}`)

    const response = await fetch(downloadUrl)
    if (!response.ok) {
      throw new Error(`Failed to download from Crust gateway. Status: ${response.status}`)
    }

    const data = await response.arrayBuffer()
    return new Uint8Array(data)
  }

  private async createAuthHeader(): Promise<string> {
    const dataToSign = utf8ToHex(this.address)
    const signed = await this.signer.signRaw({
      type: "bytes",
      address: this.address,
      data: dataToSign
    })

    return toBase64(`sub-${this.address}:${signed.signature}`)
  }

  private async pinToCrust(cid: string, authHeader: string): Promise<unknown> {
    const body = JSON.stringify({ cid, name: `assetdidcomm-${cid}` })

    const response = await fetch(this.options.pinningEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authHeader}`
      },
      body
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Crust pinning failed with status ${response.status}: ${errorText}`)
    }

    return await response.json()
  }
}

function utf8ToHex(value: string): `0x${string}` {
  const bytes = new TextEncoder().encode(value)
  let hex = ""
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0")
  }
  return `0x${hex}`
}

function toBase64(value: string): string {
  if (typeof btoa === "function") {
    return btoa(value)
  }

  const maybeBuffer = (globalThis as unknown as { Buffer?: { from(input: string, encoding?: string): { toString(encoding: string): string } } }).Buffer
  if (maybeBuffer) {
    return maybeBuffer.from(value, "utf-8").toString("base64")
  }

  throw new Error("Base64 encoding is unavailable in this runtime")
}
