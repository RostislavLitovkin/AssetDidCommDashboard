/**
 * Whether the connected user can read the *latest* bucket encryption key.
 *
 * Key-sharing messages ("didcomm/key-sharing-v1") rotate the bucket key, and
 * each rotation is addressed to the viewers of that moment. Being able to
 * decrypt *a* key therefore says nothing about being able to decrypt the
 * current one: someone dropped from the viewer set keeps every key shared
 * before they were dropped, and would otherwise go on encrypting messages to a
 * retired key that nobody in the bucket reads anymore.
 *
 * No Vue and no jose here — the page owns decryption, this owns the verdict.
 */

export type KeyAccessState = "ok" | "no-key-shared" | "no-secret" | "no-access"

/** The parts of an indexed message this module needs to order and identify it. */
export interface KeySharingRef {
  /** Unique message id — what a recovered key is matched back to. */
  id: string
  createdAt: string
  /** On-chain sequence number, used to break same-timestamp ties. */
  messageId: string
}

/** Unparseable values sort first rather than poisoning comparisons with NaN. */
function orderOf(message: KeySharingRef): [number, number] {
  const time = Date.parse(message.createdAt)
  const sequence = Number(message.messageId)
  return [Number.isNaN(time) ? 0 : time, Number.isNaN(sequence) ? 0 : sequence]
}

/**
 * The most recent key-sharing message by createdAt, tie-broken by numeric
 * messageId. Computed rather than taken from the tail of the fetched array:
 * the API's ordering is not part of its contract.
 */
export function latestKeySharingMessage<T extends KeySharingRef>(messages: readonly T[]): T | null {
  let latest: T | null = null
  let latestOrder: [number, number] = [-Infinity, -Infinity]

  for (const message of messages) {
    const order = orderOf(message)
    if (order[0] > latestOrder[0] || (order[0] === latestOrder[0] && order[1] > latestOrder[1])) {
      latest = message
      latestOrder = order
    }
  }

  return latest
}

/**
 * Why the user can or cannot use the bucket key, in the order the causes
 * matter: a bucket with no key at all blocks everyone, so it outranks a
 * missing personal secret — loading one would not unlock anything.
 */
export function resolveKeyAccessState(input: {
  hasSecret: boolean
  keySharingMessages: readonly KeySharingRef[]
  decryptedIds: Iterable<string>
}): KeyAccessState {
  const latest = latestKeySharingMessage(input.keySharingMessages)
  if (!latest) return "no-key-shared"
  if (!input.hasSecret) return "no-secret"

  const decrypted = new Set(input.decryptedIds)
  return decrypted.has(latest.id) ? "ok" : "no-access"
}

/**
 * The X25519 secret-JWK shape (kty/crv plus the public x and private d
 * coordinates), checked without jose so this module stays dependency-free.
 */
export function isX25519SecretJwk(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.kty === "OKP" &&
    candidate.crv === "X25519" &&
    typeof candidate.x === "string" && candidate.x !== "" &&
    typeof candidate.d === "string" && candidate.d !== ""
  )
}

/**
 * A key-sharing document that arrived as plaintext JSON rather than as a
 * General JWE — the realXmarket app seeds offer buckets this way. `keys` holds
 * only the entries that are valid X25519 secret JWKs, in document order.
 */
export interface PlaintextKeySharingBody {
  id: string
  from: string
  to: string[]
  keys: Array<Record<string, unknown>>
}

/**
 * Validates a plaintext key-sharing body of shape
 * {"id","from","to":[addresses],"keys":[secretJwk]}. Accepts the parsed object
 * or the raw JSON string. Returns undefined for anything that does not match —
 * callers then fall through to the JWE path. A General JWE can never
 * accidentally match: it has no `keys` array of secret JWKs.
 */
export function parsePlaintextKeySharingBody(raw: unknown): PlaintextKeySharingBody | undefined {
  let candidate: unknown = raw
  if (typeof candidate === "string") {
    if (candidate.trim() === "") return undefined
    try {
      candidate = JSON.parse(candidate)
    } catch {
      return undefined
    }
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined
  const body = candidate as Record<string, unknown>

  if (typeof body.id !== "string" || body.id.trim() === "") return undefined
  if (typeof body.from !== "string" || body.from.trim() === "") return undefined
  if (!Array.isArray(body.to)) return undefined
  const to = body.to.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
  if (to.length !== body.to.length) return undefined

  if (!Array.isArray(body.keys)) return undefined
  const keys = body.keys.filter(isX25519SecretJwk) as Array<Record<string, unknown>>
  if (!keys.length) return undefined

  return { id: body.id.trim(), from: body.from.trim(), to, keys }
}
