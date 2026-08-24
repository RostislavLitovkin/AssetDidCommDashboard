import { describe, expect, it, vi } from "vitest"
import { createIncomingMessagePump } from "../../app/services/messages/incomingMessagePump"

/** A controllable async apply: each call parks until released. */
function manualApply() {
  const applied: string[] = []
  const releases: Array<() => void> = []
  const apply = (item: string): Promise<void> => {
    applied.push(item)
    return new Promise<void>(resolve => releases.push(resolve))
  }
  const release = () => releases.shift()?.()
  return { applied, apply, release }
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

describe("createIncomingMessagePump", () => {
  it("applies immediately when the page is not busy", async () => {
    const apply = vi.fn(() => Promise.resolve())
    const pump = createIncomingMessagePump<string>({ isBusy: () => false, apply })

    pump.push("a")
    await tick()

    expect(apply).toHaveBeenCalledWith("a")
  })

  it("serializes applies — the next starts only when the previous resolved", async () => {
    const { applied, apply, release } = manualApply()
    const pump = createIncomingMessagePump<string>({ isBusy: () => false, apply })

    pump.push("a")
    pump.push("b")
    await tick()
    expect(applied).toEqual(["a"])

    release()
    await tick()
    expect(applied).toEqual(["a", "b"])
  })

  it("buffers while busy and flush() drains in arrival order", async () => {
    let busy = true
    const apply = vi.fn((_item: string) => Promise.resolve())
    const pump = createIncomingMessagePump<string>({ isBusy: () => busy, apply })

    pump.push("a")
    pump.push("b")
    await tick()
    expect(apply).not.toHaveBeenCalled()

    busy = false
    pump.flush()
    await tick()
    expect(apply.mock.calls.map(c => c[0])).toEqual(["a", "b"])
  })

  it("flush() while still busy keeps everything queued", async () => {
    const apply = vi.fn(() => Promise.resolve())
    const pump = createIncomingMessagePump<string>({ isBusy: () => true, apply })

    pump.push("a")
    pump.flush()
    await tick()

    expect(apply).not.toHaveBeenCalled()
  })

  it("applies each item exactly once across buffer and flush", async () => {
    let busy = true
    const apply = vi.fn(() => Promise.resolve())
    const pump = createIncomingMessagePump<string>({ isBusy: () => busy, apply })

    pump.push("a")
    busy = false
    pump.flush()
    pump.flush()
    await tick()

    expect(apply).toHaveBeenCalledTimes(1)
  })

  it("keeps arrival order when a push lands while older items still sit in the queue", async () => {
    let busy = true
    const apply = vi.fn((_item: string) => Promise.resolve())
    const pump = createIncomingMessagePump<string>({ isBusy: () => busy, apply })

    pump.push("a")
    busy = false
    // The busy window just closed but flush has not run yet — "b" must not
    // overtake the queued "a".
    pump.push("b")
    pump.flush()
    await tick()

    expect(apply.mock.calls.map(c => c[0])).toEqual(["a", "b"])
  })

  it("a failed apply reports through onError and does not break the chain", async () => {
    const applied: string[] = []
    const error = new Error("boom")
    const onError = vi.fn()
    const pump = createIncomingMessagePump<string>({
      isBusy: () => false,
      apply: item => {
        applied.push(item)
        return item === "a" ? Promise.reject(error) : Promise.resolve()
      },
      onError
    })

    pump.push("a")
    pump.push("b")
    await tick()

    expect(applied).toEqual(["a", "b"])
    expect(onError).toHaveBeenCalledWith(error, "a")
  })

  it("idle() resolves only after the in-flight apply finished", async () => {
    const { applied, apply, release } = manualApply()
    const pump = createIncomingMessagePump<string>({ isBusy: () => false, apply })

    pump.push("a")
    await tick()
    expect(applied).toEqual(["a"])

    let idled = false
    void pump.idle().then(() => { idled = true })
    await tick()
    expect(idled).toBe(false)

    release()
    await tick()
    expect(idled).toBe(true)
  })

  it("idle() resolves immediately when nothing is applying", async () => {
    const pump = createIncomingMessagePump<string>({ isBusy: () => false, apply: () => Promise.resolve() })

    let idled = false
    void pump.idle().then(() => { idled = true })
    await tick()

    expect(idled).toBe(true)
  })

  it("re-queues an item whose turn comes up inside a new busy window", async () => {
    const { applied, apply, release } = manualApply()
    let busy = false
    const pump = createIncomingMessagePump<string>({ isBusy: () => busy, apply })

    pump.push("a")
    pump.push("b")
    await tick()
    expect(applied).toEqual(["a"])

    // The page went busy (e.g. a reload started) while "a" was applying: "b"
    // must wait for the next flush instead of racing the reload.
    busy = true
    release()
    await tick()
    expect(applied).toEqual(["a"])

    busy = false
    pump.flush()
    await tick()
    expect(applied).toEqual(["a", "b"])
    release()
  })
})
