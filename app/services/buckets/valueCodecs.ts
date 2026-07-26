/**
 * Value codecs shared by the buckets service layer: fixed-32-byte key
 * normalization, utf-8 sha256 hashing, and file/text message classification.
 *
 * Ported verbatim from `app/services/papi/didCommRepository.ts` (normalizeFixed32ByteKey,
 * sha256HexUtf8, and their private helpers) and `app/services/indexer/subqueryClient.ts`
 * (the content-type constants and isFileMessage) so output formats keep matching data
 * already stored by the old backend. Do not "clean up" the logic here without also
 * re-verifying every caller of the old locations, which are slated for deletion.
 */

// -- sha256HexUtf8 (ported from app/services/papi/didCommRepository.ts:2641) --

async function sha256HexUtf8(input: string): Promise<`0x${string}`> {
  const bytes = new TextEncoder().encode(input)

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes)
    return bytesToHex(new Uint8Array(digest))
  }

  const { createHash } = await import("node:crypto")
  const hash = createHash("sha256").update(bytes).digest()
  return bytesToHex(Uint8Array.from(hash.values()))
}

// -- normalizeFixed32ByteKey (ported from app/services/papi/didCommRepository.ts:3171) --

function normalizeFixed32ByteKey(input: string): `0x${string}` {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error("New encryption key is required")
  }

  const fromHex = tryParseHexBytes(trimmed)
  if (fromHex) {
    if (fromHex.length !== 32) {
      throw new Error(`Expected input with 32 bytes (256 bits), found ${fromHex.length} bytes`)
    }
    return bytesToHex(fromHex)
  }

  const fromBase64Url = tryDecodeBase64Url(trimmed)
  if (fromBase64Url) {
    if (fromBase64Url.length !== 32) {
      throw new Error(`Expected input with 32 bytes (256 bits), found ${fromBase64Url.length} bytes`)
    }
    return bytesToHex(fromBase64Url)
  }

  const fromUtf8 = new TextEncoder().encode(trimmed)
  if (fromUtf8.length === 32) {
    return bytesToHex(fromUtf8)
  }

  throw new Error(`Expected input with 32 bytes (256 bits), found ${fromUtf8.length} bytes`)
}

// -- Private helpers used by the ports above (ported from app/services/papi/didCommRepository.ts) --

function tryParseHexBytes(value: string): Uint8Array | undefined {
  if (!/^0x[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    return undefined
  }

  const payload = value.slice(2)
  const bytes = new Uint8Array(payload.length / 2)
  for (let index = 0; index < payload.length; index += 2) {
    bytes[index / 2] = Number.parseInt(payload.slice(index, index + 2), 16)
  }
  return bytes
}

function tryDecodeBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return undefined
  }

  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const paddingLength = (4 - (base64.length % 4)) % 4
  const padded = `${base64}${"=".repeat(paddingLength)}`

  try {
    if (typeof atob === "function") {
      const binary = atob(padded)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      return bytes
    }

    const globalWithBuffer = globalThis as unknown as {
      Buffer?: { from(input: string, encoding: string): { values(): Iterable<number> } }
    }
    if (globalWithBuffer.Buffer) {
      const buffer = globalWithBuffer.Buffer.from(padded, "base64")
      return Uint8Array.from(buffer.values())
    }
  } catch {
    return undefined
  }

  return undefined
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = ""
  for (const value of bytes) {
    hex += value.toString(16).padStart(2, "0")
  }
  return `0x${hex}`
}

// -- Content-type discriminators + isFileMessage (ported from app/services/indexer/subqueryClient.ts:276-292) --

// Content-type discriminators shared with the message-sending path. A file message
// carries a real MIME content type; text and key-sharing payloads use these reserved
// values and are never treated as files.
export const TEXT_CONTENT_TYPE = "text/plain;charset=utf-8"
export const KEY_SHARING_CONTENT_TYPE = "application/didcomm-encrypted+json"
export const KEY_SHARING_MESSAGE_TAG = "didcomm/key-sharing-v1"

/**
 * True when an indexed message is a file/image attachment (not a text message or a
 * key-sharing event). Mirrors the server-side filter so callers can guard against
 * any unexpected rows.
 */
export function isFileMessage(message: { contentType: string | null; tag: string | null }): boolean {
  if (message.tag === KEY_SHARING_MESSAGE_TAG) {
    return false
  }

  const contentType = message.contentType?.trim()
  return Boolean(contentType && contentType !== TEXT_CONTENT_TYPE && contentType !== KEY_SHARING_CONTENT_TYPE)
}

export { normalizeFixed32ByteKey, sha256HexUtf8 }
