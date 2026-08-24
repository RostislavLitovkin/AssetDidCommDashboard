import { describe, expect, it, vi } from "vitest"
import {
  connectBucketMessagesSocket,
  type MinimalSocket,
  type SubscriptionAck
} from "../../app/services/buckets/bucketMessagesSocket"
import type { ApiMessage } from "../../app/services/buckets/types"

/** In-memory stand-in for a socket.io client socket. */
class FakeSocket implements MinimalSocket {
  listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  emitted: Array<{ event: string; args: unknown[] }> = []
  disconnects = 0

  on(event: string, listener: (...args: unknown[]) => void): void {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
  }

  emit(event: string, ...args: unknown[]): void {
    this.emitted.push({ event, args })
  }

  disconnect(): void {
    this.disconnects += 1
  }

  // ── test drivers ──────────────────────────────────────────────────
  fire(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }

  subscribes(): Array<{ event: string; args: unknown[] }> {
    return this.emitted.filter(e => e.event === "subscribe")
  }

  /** Answer the most recent subscribe emit's ack callback. */
  ackLastSubscribe(ack: SubscriptionAck): void {
    const last = this.subscribes().at(-1)
    if (!last) throw new Error("nothing subscribed")
    const callback = last.args.at(-1)
    if (typeof callback !== "function") throw new Error("subscribe emitted without ack callback")
    ;(callback as (ack: SubscriptionAck) => void)(ack)
  }
}

const WIRE_MESSAGE = {
  id: "6-3",
  bucketId: "6",
  messageId: "3",
  messageIdNumber: "3",
  contributor: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
  reference: "bafybeigdyrzt5example",
  tag: null,
  description: null,
  contentType: "text/plain",
  contentHash: "0x11",
  ipfsContent: "hello",
  createdAt: "2026-08-24T10:30:00.0000000Z"
}

function connect(handlers: Partial<Parameters<typeof connectBucketMessagesSocket>[2]> = {}) {
  const fake = new FakeSocket()
  const factory = vi.fn(() => fake)
  const socket = connectBucketMessagesSocket("https://profile-api.example", "6", {
    onMessage: () => {},
    ...handlers
  }, factory)
  return { fake, factory, socket }
}

describe("connectBucketMessagesSocket", () => {
  it("connects to the API URL with the websocket transport only", () => {
    const { factory } = connect()

    expect(factory).toHaveBeenCalledWith("https://profile-api.example", { transports: ["websocket"] })
  })

  it("subscribes to the bucket on connect", () => {
    const { fake } = connect()

    fake.fire("connect")

    expect(fake.subscribes()).toHaveLength(1)
    expect(fake.subscribes()[0]!.args[0]).toBe("6")
  })

  it("resubscribes on every reconnect — subscriptions are per-connection state", () => {
    const { fake } = connect()

    fake.fire("connect")
    fake.fire("connect")

    expect(fake.subscribes()).toHaveLength(2)
  })

  it("signals onSubscribed on every successful subscribe ack — first connect included", () => {
    const onSubscribed = vi.fn()
    const { fake } = connect({ onSubscribed })

    fake.fire("connect")
    // Not on the emit: only the ack proves the subscription is active
    // server-side, so a catch-up fetch issued on the signal cannot race a
    // write past the subscription window.
    expect(onSubscribed).not.toHaveBeenCalled()
    fake.ackLastSubscribe({ ok: true, bucketId: "6" })
    expect(onSubscribed).toHaveBeenCalledTimes(1)

    fake.fire("connect")
    fake.ackLastSubscribe({ ok: true, bucketId: "6" })
    expect(onSubscribed).toHaveBeenCalledTimes(2)
  })

  it("does not signal onSubscribed for a refused subscription", () => {
    const onSubscribed = vi.fn()
    const onSubscribeError = vi.fn()
    const { fake } = connect({ onSubscribed, onSubscribeError })

    fake.fire("connect")
    fake.ackLastSubscribe({ ok: false, bucketId: "6", error: { code: "UNKNOWN_BUCKET", message: "no" } })

    expect(onSubscribed).not.toHaveBeenCalled()
    expect(onSubscribeError).toHaveBeenCalledTimes(1)
  })

  it("delivers messages of the subscribed bucket shaped as ApiMessage", () => {
    const received: ApiMessage[] = []
    const { fake } = connect({ onMessage: m => received.push(m) })

    fake.fire("connect")
    fake.fire("message", WIRE_MESSAGE)

    expect(received).toEqual([{
      id: "6-3",
      bucketId: "6",
      messageId: "3",
      contributor: WIRE_MESSAGE.contributor,
      reference: "bafybeigdyrzt5example",
      tag: null,
      description: null,
      contentType: "text/plain",
      contentHash: "0x11",
      ipfsContent: "hello",
      createdAt: "2026-08-24T10:30:00.0000000Z"
    }])
  })

  it("ignores messages for other buckets — one connection can carry several subscriptions", () => {
    const onMessage = vi.fn()
    const { fake } = connect({ onMessage })

    fake.fire("message", { ...WIRE_MESSAGE, bucketId: "7", id: "7-3" })

    expect(onMessage).not.toHaveBeenCalled()
  })

  it("ignores payloads that do not look like a message", () => {
    const onMessage = vi.fn()
    const { fake } = connect({ onMessage })

    fake.fire("message", null)
    fake.fire("message", "6-3")
    fake.fire("message", { bucketId: "6" })
    fake.fire("message", { ...WIRE_MESSAGE, messageId: 3 })

    expect(onMessage).not.toHaveBeenCalled()
  })

  it("reports a refused subscription through onSubscribeError", () => {
    const onSubscribeError = vi.fn()
    const { fake } = connect({ onSubscribeError })

    fake.fire("connect")
    fake.ackLastSubscribe({ ok: false, bucketId: "6", error: { code: "UNKNOWN_BUCKET", message: "no such bucket" } })

    expect(onSubscribeError).toHaveBeenCalledWith({ code: "UNKNOWN_BUCKET", message: "no such bucket" })
  })

  it("stays quiet on a successful subscription ack", () => {
    const onSubscribeError = vi.fn()
    const { fake } = connect({ onSubscribeError })

    fake.fire("connect")
    fake.ackLastSubscribe({ ok: true, bucketId: "6" })

    expect(onSubscribeError).not.toHaveBeenCalled()
  })

  it("close() disconnects and silences every later event, a late ack included", () => {
    const onMessage = vi.fn()
    const onSubscribed = vi.fn()
    const { fake, socket } = connect({ onMessage, onSubscribed })
    fake.fire("connect")

    socket.close()
    socket.close() // idempotent
    fake.fire("message", WIRE_MESSAGE)
    fake.fire("connect")
    fake.ackLastSubscribe({ ok: true, bucketId: "6" })

    expect(fake.disconnects).toBe(1)
    expect(onMessage).not.toHaveBeenCalled()
    expect(onSubscribed).not.toHaveBeenCalled()
    expect(fake.subscribes()).toHaveLength(1)
  })

  it("trims the bucket id before subscribing and matching", () => {
    const received: ApiMessage[] = []
    const fake = new FakeSocket()
    connectBucketMessagesSocket("https://x", " 6 ", { onMessage: m => received.push(m) }, () => fake)

    fake.fire("connect")
    fake.fire("message", WIRE_MESSAGE)

    expect(fake.subscribes()[0]!.args[0]).toBe("6")
    expect(received).toHaveLength(1)
  })
})
