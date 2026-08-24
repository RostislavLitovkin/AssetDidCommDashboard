import { io } from "socket.io-client"
import type { ApiMessage } from "./types"

/**
 * Realtime bucket messages over the profile API's Socket.IO endpoint
 * (`/socket.io/`, websocket transport only — the server implements no HTTP
 * long-polling). The socket delivers only messages written while the
 * connection is up: at-most-once, no history, no replay. History and anything
 * missed across a reconnect must be fetched through the GraphQL API.
 */

/** Ack payload of the `subscribe`/`unsubscribe` events. */
export interface SubscriptionAck {
  ok: boolean
  bucketId?: string
  error?: { code: string; message: string }
}

export interface BucketMessagesSocketHandlers {
  /** A new message written to the subscribed bucket. */
  onMessage: (message: ApiMessage) => void
  /**
   * The bucket subscription is established server-side — fired on every
   * successful subscribe ack, the first connect included. Delivery starts
   * only from the subscription, so the caller should reconcile against the
   * GraphQL API each time: on the first connect that covers writes racing the
   * initial history fetch, after a reconnect everything written while offline.
   */
  onSubscribed?: () => void
  /** The server refused the subscription (`UNKNOWN_BUCKET`, `INVALID_INPUT`, …). */
  onSubscribeError?: (error: { code: string; message: string }) => void
}

/** The slice of a socket.io client socket this service uses — injectable for tests. */
export interface MinimalSocket {
  // `any[]` matches socket.io's own listener typing, keeping the real Socket
  // and test fakes both assignable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown
  emit(event: string, ...args: unknown[]): unknown
  disconnect(): unknown
}

export type SocketFactory = (url: string, opts: { transports: string[] }) => MinimalSocket

export interface BucketMessagesSocket {
  close(): void
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

/**
 * The wire payload matches the GraphQL `Message` type field for field, plus
 * `bucketId` and a `messageIdNumber` this dashboard does not use. Pick the
 * `ApiMessage` fields explicitly so wire extras never leak into state.
 */
function toApiMessage(raw: unknown): ApiMessage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (
    typeof r.id !== "string" || typeof r.messageId !== "string"
    || typeof r.bucketId !== "string" || typeof r.contributor !== "string"
    || typeof r.createdAt !== "string"
  ) return null

  return {
    id: r.id,
    messageId: r.messageId,
    bucketId: r.bucketId,
    contributor: r.contributor,
    reference: optionalString(r.reference),
    tag: optionalString(r.tag),
    description: optionalString(r.description),
    contentType: optionalString(r.contentType),
    contentHash: optionalString(r.contentHash),
    ipfsContent: optionalString(r.ipfsContent),
    createdAt: r.createdAt
  }
}

export function connectBucketMessagesSocket(
  apiUrl: string,
  bucketId: string,
  handlers: BucketMessagesSocketHandlers,
  socketFactory: SocketFactory = (url, opts) => io(url, opts)
): BucketMessagesSocket {
  const id = bucketId.trim()
  const socket = socketFactory(apiUrl, { transports: ["websocket"] })
  let closed = false

  socket.on("connect", () => {
    if (closed) return
    // Subscriptions are per-connection state: subscribe on every connect so
    // the client's automatic reconnects re-establish them.
    socket.emit("subscribe", id, (ack: SubscriptionAck | undefined) => {
      if (closed) return
      if (ack?.ok) {
        // Signalled from the ack, not the emit: only then is the subscription
        // provably active server-side, so a catch-up fetch issued now cannot
        // race a write past the subscription window.
        handlers.onSubscribed?.()
      } else {
        handlers.onSubscribeError?.(
          ack?.error ?? { code: "NO_ACK", message: "subscribe was not acknowledged" }
        )
      }
    })
  })

  socket.on("message", (raw: unknown) => {
    if (closed) return
    const message = toApiMessage(raw)
    if (!message || message.bucketId !== id) return
    handlers.onMessage(message)
  })

  return {
    close() {
      if (closed) return
      closed = true
      socket.disconnect()
    }
  }
}
