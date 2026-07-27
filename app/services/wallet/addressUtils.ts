/**
 * One address normalizer for everything that talks to the profile API.
 * The API stores addresses as sent; the dashboard convention is SS58 prefix 42
 * for Polkadot identities and raw base58 for Solana identities.
 */
import { base58Decode, decodeAddress, encodeAddress } from "@polkadot/util-crypto"

/** True when the value is a raw base58 32-byte key (Solana) and NOT valid SS58. */
export function isSolanaAddress(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }

  try {
    decodeAddress(trimmed)
    return false
  } catch {
    // not SS58 — fall through to the base58 check
  }

  try {
    return base58Decode(trimmed).length === 32
  } catch {
    return false
  }
}

/** SS58 (any prefix) -> prefix 42; Solana base58 and anything else -> trimmed passthrough. */
export function normalizeApiAddress(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return trimmed
  }

  try {
    return encodeAddress(decodeAddress(trimmed), 42)
  } catch {
    return trimmed
  }
}
