import type { JWK } from "jose"

export type KeyOrigin = "generated" | "imported"
export type KeyValidationState = "valid" | "invalid"

export interface KeyMaterial {
  keyId: string
  algorithm: "X25519"
  origin: KeyOrigin
  publicJwk: JWK
  privateJwk?: JWK
  canExport: boolean
  validationState: KeyValidationState
  createdAt: string
}
