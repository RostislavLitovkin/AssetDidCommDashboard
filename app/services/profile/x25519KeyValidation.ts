/**
 * Validation for the X25519 public key a profile carries.
 *
 * The dashboard writes JWK `x` values into that field (base64url, unpadded, as
 * produced by `jose.exportJWK`), but keys pasted from other tooling are often
 * standard base64 — both alphabets are accepted, with or without padding.
 */

export const X25519_PUBLIC_KEY_BYTES = 32

const BASE64_ALPHABET = /^[A-Za-z0-9+/]+={0,2}$/
const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]+={0,2}$/

/** Decodes standard or URL-safe base64. Returns null when the input is not base64. */
export function decodeBase64Key(value: string): Uint8Array | null {
  const trimmed = value.trim()
  if (!BASE64_ALPHABET.test(trimmed) && !BASE64URL_ALPHABET.test(trimmed)) {
    return null
  }

  const unpadded = trimmed.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "")
  // base64 packs 3 bytes into 4 characters, so a leftover of a single character
  // carries too few bits to be a byte and can never be valid.
  if (unpadded.length % 4 === 1) {
    return null
  }

  try {
    const binary = atob(unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, "="))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    return bytes
  } catch {
    return null
  }
}

/** Returns a human-readable problem with the key, or an empty string when it is usable. */
export function validateX25519PublicKey(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return "An X25519 public key is required."
  }

  const bytes = decodeBase64Key(trimmed)
  if (!bytes) {
    return "This is not valid base64. Paste the key exactly as your key file or the sidebar shows it."
  }

  if (bytes.length !== X25519_PUBLIC_KEY_BYTES) {
    return `An X25519 public key is ${X25519_PUBLIC_KEY_BYTES} bytes; this one decodes to ${bytes.length}.`
  }

  return ""
}
