/**
 * Serializes the application of live incoming messages and holds them back
 * while the page is busy replacing state wholesale (initial load, post-send
 * reload): a socket event applied mid-`loadAll` would race the reload and
 * could be lost or rendered twice. Items pushed during a busy window queue up;
 * `flush()` — called whenever a busy window closes — drains them in arrival
 * order. Application is serialized: one item's async `apply` finishes before
 * the next starts, so per-message decrypt/hydrate state never interleaves.
 */

export interface IncomingMessagePump<T> {
  /** Apply now, or queue when the page is busy or older items are queued. */
  push(item: T): void
  /** Drain the queue. No-op while the page is still busy. */
  flush(): void
  /**
   * Resolves once every apply scheduled so far has finished. Callers that
   * replace state wholesale open their busy window first, then await this so
   * an in-flight apply cannot write over the replacement. Never rejects.
   */
  idle(): Promise<void>
}

export function createIncomingMessagePump<T>(options: {
  isBusy: () => boolean
  apply: (item: T) => Promise<void>
  onError?: (error: unknown, item: T) => void
}): IncomingMessagePump<T> {
  const queue: T[] = []
  let chain: Promise<void> = Promise.resolve()

  const schedule = (item: T): void => {
    chain = chain.then(async () => {
      // A busy window may have opened while earlier items were applying —
      // re-queue for the flush that closes it instead of racing the reload.
      if (options.isBusy()) {
        queue.push(item)
        return
      }
      try {
        await options.apply(item)
      } catch (error) {
        options.onError?.(error, item)
      }
    })
  }

  return {
    push(item: T): void {
      // Queued items must keep their head start — jumping the queue would
      // apply messages out of arrival order.
      if (options.isBusy() || queue.length) queue.push(item)
      else schedule(item)
    },
    flush(): void {
      if (options.isBusy()) return
      while (queue.length) schedule(queue.shift()!)
    },
    idle(): Promise<void> {
      return chain
    }
  }
}
