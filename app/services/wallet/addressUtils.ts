/**
 * One address normalizer for everything that talks to the profile API.
 * The API stores addresses as sent; the dashboard convention is SS58 prefix 42
 * for Polkadot identities and raw base58 for Solana identities.
 */
import { hexToU8a, u8aToHex } from "@polkadot/util"
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

/** True when the value is an SS58 address of any prefix. */
export function isSs58Address(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }

  try {
    decodeAddress(trimmed)
    return true
  } catch {
    return false
  }
}

/**
 * True when the value could be an address at all — SS58 or Solana base58.
 * Lets a single input field tell an address from a profile nickname.
 */
export function isAddressLike(value: string): boolean {
  return isSs58Address(value) || isSolanaAddress(value)
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

function toAddressBytes(value: string): Uint8Array | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    try {
      return hexToU8a(trimmed)
    } catch {
      return undefined
    }
  }

  try {
    return decodeAddress(trimmed)
  } catch {
    return undefined
  }
}

/** The 32-byte public key behind an SS58 address or 0x-hex key, lowercased hex. */
export function toPublicKeyHex(value: string): string | undefined {
  const bytes = toAddressBytes(value)
  if (!bytes || bytes.length !== 32) {
    return undefined
  }

  return u8aToHex(bytes).toLowerCase()
}

/** Same identity? Compares public keys so SS58 prefixes never matter. */
export function addressesEqual(left: string, right: string): boolean {
  const leftHex = toPublicKeyHex(left)
  const rightHex = toPublicKeyHex(right)

  if (leftHex && rightHex) {
    return leftHex === rightHex
  }

  // base58 is case-sensitive — never lowercase Solana addresses.
  if (isSolanaAddress(left) || isSolanaAddress(right)) {
    return left.trim() === right.trim()
  }

  return left.trim().toLowerCase() === right.trim().toLowerCase()
}
