import * as jose from "jose"
import type { KeyMaterial } from "../../types/keys"

function newKeyId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

export class X25519KeyService {
  async generate(): Promise<KeyMaterial> {
    const { publicKey, privateKey } = await jose.generateKeyPair("ECDH-ES+A256KW", {
      crv: "X25519",
      extractable: true
    })
    const publicJwk = await jose.exportJWK(publicKey)
    const privateJwk = await jose.exportJWK(privateKey)
    const keyId = newKeyId()
    publicJwk.kid = keyId
    privateJwk.kid = keyId

    return {
      keyId,
      algorithm: "X25519",
      origin: "generated",
      publicJwk,
      privateJwk,
      canExport: true,
      validationState: "valid",
      createdAt: new Date().toISOString()
    }
  }

  import(rawJson: string): KeyMaterial {
    const parsed = JSON.parse(rawJson) as { publicJwk?: Record<string, unknown>; privateJwk?: Record<string, unknown> }
    if (!parsed.publicJwk) {
      throw new Error("KEY_VALIDATION_ERROR")
    }

    return {
      keyId: String(parsed.publicJwk.kid || newKeyId()),
      algorithm: "X25519",
      origin: "imported",
      publicJwk: parsed.publicJwk,
      privateJwk: parsed.privateJwk,
      canExport: true,
      validationState: "valid",
      createdAt: new Date().toISOString()
    }
  }

  export(material: KeyMaterial): string {
    return JSON.stringify({ publicJwk: material.publicJwk, privateJwk: material.privateJwk }, null, 2)
  }
}
