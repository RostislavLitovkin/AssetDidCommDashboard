/**
 * Wallet-agnostic half of API request signing. Both the sr25519 and Solana
 * schemes sign the SAME payload string; only the signing of that payload
 * differs (sr25519 signs its blake2-128 hash, Solana signs the raw bytes).
 */
import {
  buildSignaturePayload,
  formatSignatureTimestamp,
  toCSharpHashHex
} from "../profile/profileSigning"

export interface ComposedSignaturePayload {
  payload: string
  timestamp: string
}

export function composeApiSignaturePayload(
  method: string,
  path: string,
  bodyHash: string
): ComposedSignaturePayload {
  const timestamp = formatSignatureTimestamp(new Date())
  return { payload: buildSignaturePayload(method, path, bodyHash, timestamp), timestamp }
}

/** Blake2b-128 of the raw body, in the API's 0x+UPPERCASE form. */
export async function hashApiBody(rawBody: string): Promise<string> {
  const { blake2AsHex, cryptoWaitReady } = await import("@polkadot/util-crypto")
  await cryptoWaitReady()
  return toCSharpHashHex(blake2AsHex(rawBody, 128))
}
