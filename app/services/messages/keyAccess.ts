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
