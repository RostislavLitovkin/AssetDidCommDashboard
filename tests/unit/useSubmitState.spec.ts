// tests/unit/useSubmitState.spec.ts
import { describe, expect, it } from "vitest"
import { useSubmitState } from "../../app/composables/useSubmitState"

describe("useSubmitState", () => {
  it("starts idle and not busy", () => {
    const state = useSubmitState()
    expect(state.phase.value).toBe("idle")
    expect(state.errorMessage.value).toBe("")
    expect(state.isBusy.value).toBe(false)
  })

  it("run() opens on signing and lands on success", async () => {
    const state = useSubmitState()
    const seen: string[] = []

    const result = await state.run(async () => {
      seen.push(state.phase.value)
      return "done"
    })

    expect(seen).toEqual(["signing"])
    expect(result).toBe("done")
    expect(state.phase.value).toBe("success")
    expect(state.isBusy.value).toBe(false)
  })

  it("run() records the rejection message and does not rethrow", async () => {
    const state = useSubmitState()

    const result = await state.run(async () => {
      throw new Error("nickname taken")
    })

    expect(result).toBeUndefined()
    expect(state.phase.value).toBe("error")
    expect(state.errorMessage.value).toBe("nickname taken")
  })

  it("run() falls back to a generic message for non-Error rejections", async () => {
    const state = useSubmitState()
    await state.run(async () => {
      throw "boom"
    })
    expect(state.errorMessage.value).toBe("Something went wrong")
  })

  it("run() clears a previous error message when it starts", async () => {
    const state = useSubmitState()
    await state.run(async () => {
      throw new Error("first")
    })
    expect(state.errorMessage.value).toBe("first")

    await state.run(async () => "ok")
    expect(state.errorMessage.value).toBe("")
    expect(state.phase.value).toBe("success")
  })

  it("applyUpdate maps repository stages onto in-flight phases", () => {
    const state = useSubmitState()

    state.applyUpdate({ stage: "signing", message: "" })
    expect(state.phase.value).toBe("signing")
    expect(state.isBusy.value).toBe(true)

    state.applyUpdate({ stage: "submitting", message: "" })
    expect(state.phase.value).toBe("submitting")
    expect(state.isBusy.value).toBe(true)
  })

  it("applyUpdate ignores terminal stages so run() stays the only authority", () => {
    const state = useSubmitState()
    state.applyUpdate({ stage: "submitting", message: "" })

    state.applyUpdate({ stage: "success", message: "" })
    expect(state.phase.value).toBe("submitting")

    state.applyUpdate({ stage: "error", message: "" })
    expect(state.phase.value).toBe("submitting")
  })

  it("fail() reports a pre-flight validation failure without running a task", () => {
    const state = useSubmitState()
    state.fail("Namespace name is required")
    expect(state.phase.value).toBe("error")
    expect(state.errorMessage.value).toBe("Namespace name is required")
  })

  it("reset() returns to idle from every terminal phase", async () => {
    const state = useSubmitState()

    await state.run(async () => "ok")
    state.reset()
    expect(state.phase.value).toBe("idle")

    state.fail("nope")
    state.reset()
    expect(state.phase.value).toBe("idle")
    expect(state.errorMessage.value).toBe("")
  })

  it("markSigning and markSubmitting drive the phase directly", () => {
    const state = useSubmitState()
    state.markSigning()
    expect(state.phase.value).toBe("signing")
    state.markSubmitting()
    expect(state.phase.value).toBe("submitting")
  })
})
