// tests/unit/submitButtonView.spec.ts
import { describe, expect, it } from "vitest"
import { resolveSubmitButtonView, type SubmitButtonLabels } from "../../app/components/common/submitButtonView"

const labels: SubmitButtonLabels = {
  idle: "Create namespace",
  signing: "Signing…",
  submitting: "Creating namespace…",
  success: "Namespace created",
  error: "Create failed — retry"
}

describe("resolveSubmitButtonView", () => {
  it("shows the idle label, no icon, and follows the disabled prop", () => {
    expect(resolveSubmitButtonView("idle", labels, false)).toEqual({
      label: "Create namespace", icon: "none", variant: "primary", disabled: false
    })
    expect(resolveSubmitButtonView("idle", labels, true).disabled).toBe(true)
  })

  it("spins and locks while signing", () => {
    expect(resolveSubmitButtonView("signing", labels, false)).toEqual({
      label: "Signing…", icon: "spinner", variant: "primary", disabled: true
    })
  })

  it("spins and locks while submitting", () => {
    expect(resolveSubmitButtonView("submitting", labels, false)).toEqual({
      label: "Creating namespace…", icon: "spinner", variant: "primary", disabled: true
    })
  })

  it("locks on success regardless of the disabled prop", () => {
    expect(resolveSubmitButtonView("success", labels, false)).toEqual({
      label: "Namespace created", icon: "check", variant: "success", disabled: true
    })
  })

  it("stays clickable on error so the button is the retry affordance", () => {
    expect(resolveSubmitButtonView("error", labels, false)).toEqual({
      label: "Create failed — retry", icon: "retry", variant: "error", disabled: false
    })
  })

  it("still honours the disabled prop on error", () => {
    expect(resolveSubmitButtonView("error", labels, true).disabled).toBe(true)
  })

  it("locks while busy even when the disabled prop is false", () => {
    expect(resolveSubmitButtonView("signing", labels, false).disabled).toBe(true)
    expect(resolveSubmitButtonView("submitting", labels, false).disabled).toBe(true)
  })
})
