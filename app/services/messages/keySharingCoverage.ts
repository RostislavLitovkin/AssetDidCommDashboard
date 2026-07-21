/**
 * Coverage check for "didcomm/key-sharing-v1" messages.
 *
 * A key-sharing message is a General JWE whose recipients carry the viewer
 * X25519 public key as their `kid`. Producers disagree on the encoding of that
 * key (on-chain 0x-hex vs JWK base64url vs padded base64), so both kids and
 * viewer keys are canonicalized to unpadded base64url of the raw 32 key bytes
 * before comparison.
 */

const HEX_32_BYTE_PATTERN = /^0x[0-9a-fA-F]{64}$/
const X25519_KEY_LENGTH = 32

function decodeBase64Loose(value: string): Uint8Array | null {
  if (!value || /[^A-Za-z0-9+/_=-]/.test(value)) return null
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "")
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Canonical unpadded-base64url form of an X25519 public key given in 0x-hex,
 * base64url, or padded base64. Returns null for anything that is not a
 * 32-byte key (e.g. numeric bucket key ids or placeholder strings).
 */
export function canonicalizeX25519(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (HEX_32_BYTE_PATTERN.test(trimmed)) {
    const bytes = new Uint8Array(X25519_KEY_LENGTH)
    for (let i = 0; i < X25519_KEY_LENGTH; i++) {
      bytes[i] = parseInt(trimmed.slice(2 + i * 2, 4 + i * 2), 16)
    }
    return encodeBase64Url(bytes)
  }

  const bytes = decodeBase64Loose(trimmed)
  return bytes?.length === X25519_KEY_LENGTH ? encodeBase64Url(bytes) : null
}

function kidOf(header: unknown): string | null {
  if (!header || typeof header !== "object" || Array.isArray(header)) return null
  const kid = (header as Record<string, unknown>).kid
  return typeof kid === "string" && kid ? kid : null
}

/**
 * All recipient `kid` values of a JWE serialized as JSON (general or
 * flattened). Returns null when the payload is not parseable as a JWE.
 */
export function extractRecipientKids(jweJson: string): string[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(jweJson)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null

  const jwe = parsed as Record<string, unknown>
  if (typeof jwe.ciphertext !== "string") return null

  const kids: string[] = []
  if (Array.isArray(jwe.recipients)) {
    for (const recipient of jwe.recipients) {
      if (!recipient || typeof recipient !== "object") continue
      const kid = kidOf((recipient as Record<string, unknown>).header)
      if (kid) kids.push(kid)
    }
  }
  // Flattened serialization keeps the single recipient header at the top level.
  for (const header of [jwe.header, jwe.unprotected]) {
    const kid = kidOf(header)
    if (kid) kids.push(kid)
  }
  return kids
}

/**
 * Viewer keys (any supported encoding) that no recipient kid of the
 * key-sharing JWE covers. Viewer keys that cannot be decoded are skipped —
 * they can never match a kid and re-sharing the key cannot fix them.
 * Returns null when the payload is not parseable as a JWE.
 */
export function findViewersWithoutKeyAccess(jweJson: string, viewerKeys: string[]): string[] | null {
  const kids = extractRecipientKids(jweJson)
  if (kids === null) return null

  const covered = new Set(kids.map(canonicalizeX25519).filter((kid): kid is string => kid !== null))
  return viewerKeys.filter(viewerKey => {
    const canonical = canonicalizeX25519(viewerKey)
    return canonical !== null && !covered.has(canonical)
  })
}
