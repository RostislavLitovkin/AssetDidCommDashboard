import type { SubmitPhase } from "../../composables/useSubmitState"

export interface SubmitButtonLabels {
  idle: string
  signing: string
  submitting: string
  success: string
  error: string
}

export type SubmitButtonIcon = "none" | "spinner" | "check" | "retry"
export type SubmitButtonVariant = "primary" | "success" | "error"

export interface SubmitButtonView {
  label: string
  icon: SubmitButtonIcon
  variant: SubmitButtonVariant
  disabled: boolean
}

/** `disabled` is the page's own gating (invalid form, missing permission). The
 *  in-flight and success phases lock the button on top of it; the error phase
 *  does not, so the button itself is the retry affordance. */
export function resolveSubmitButtonView(
  phase: SubmitPhase,
  labels: SubmitButtonLabels,
  disabled: boolean
): SubmitButtonView {
  switch (phase) {
    case "signing":
      return { label: labels.signing, icon: "spinner", variant: "primary", disabled: true }
    case "submitting":
      return { label: labels.submitting, icon: "spinner", variant: "primary", disabled: true }
    case "success":
      return { label: labels.success, icon: "check", variant: "success", disabled: true }
    case "error":
      return { label: labels.error, icon: "retry", variant: "error", disabled }
    default:
      return { label: labels.idle, icon: "none", variant: "primary", disabled }
  }
}
