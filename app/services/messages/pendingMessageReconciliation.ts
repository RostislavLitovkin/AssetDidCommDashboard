/**
 * Reconciliation between optimistic ("pending") outgoing bubbles and the
 * server copies of the same messages.
 *
 * Sending reloads the bucket so the new message shows up for real, but the
 * reload publishes the message list before its payloads are hydrated and
 * decrypted — for a file that means a gateway fetch of the whole encrypted
 * blob. The pending bubble cannot be dropped until that finishes, or the
 * message would flash as an unhydrated placeholder. So for the length of the
 * reload both copies exist and the message renders twice.
 *
 * The write response tells us which server message a pending bubble became, so
 * the pending entry "claims" that id and the render pass hides the server copy
 * until the pending bubble goes away. Exactly one bubble is on screen
 * throughout: the sending status first, the real message after.
 */

export interface ClaimingPendingMessage {
  /** Server message id, known only once the write has resolved. */
  serverId?: string | null
}

/** Server message ids currently owned by an in-flight pending bubble. */
export function claimedServerMessageIds(pending: readonly ClaimingPendingMessage[]): Set<string> {
  const claimed = new Set<string>()
  for (const entry of pending) {
    if (entry.serverId) claimed.add(entry.serverId)
  }
  return claimed
}

/**
 * `messages` minus the ones a pending bubble is still standing in for.
 * Returns a new list; the input is left untouched.
 */
export function withoutClaimedMessages<T extends { id: string }>(
  messages: readonly T[],
  pending: readonly ClaimingPendingMessage[]
): T[] {
  const claimed = claimedServerMessageIds(pending)
  if (!claimed.size) return [...messages]
  return messages.filter(message => !claimed.has(message.id))
}
