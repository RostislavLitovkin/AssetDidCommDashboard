import { computed, ref, type ComputedRef, type Ref } from "vue"
import type { OperationUpdate } from "../services/buckets/types"

export type SubmitPhase = "idle" | "signing" | "submitting" | "success" | "error"

export interface SubmitState {
  phase: Ref<SubmitPhase>
  errorMessage: Ref<string>
  isBusy: ComputedRef<boolean>
  markSigning: () => void
  markSubmitting: () => void
  applyUpdate: (update: OperationUpdate) => void
  fail: (message: string) => void
  reset: () => void
  run: <T>(task: () => Promise<T>) => Promise<T | undefined>
}

/**
 * Phase machine shared by every page that submits user-entered data.
 *
 * Validation deliberately sits outside the machine: pages that check something
 * asynchronously before submitting (profile nickname availability) surface that
 * through their own field-level text, and folding it in here would make the
 * button report a stage the operation is not actually in.
 */
export function useSubmitState(): SubmitState {
  const phase = ref<SubmitPhase>("idle")
  const errorMessage = ref("")
  const isBusy = computed(() => phase.value === "signing" || phase.value === "submitting")

  function markSigning(): void {
    phase.value = "signing"
  }

  function markSubmitting(): void {
    phase.value = "submitting"
  }

  /** Only the in-flight stages come from the caller — run() owns the outcome,
   *  because it is the only thing that sees the resolved value or the throw. */
  function applyUpdate(update: OperationUpdate): void {
    if (update.stage === "signing") markSigning()
    else if (update.stage === "submitting") markSubmitting()
  }

  function fail(message: string): void {
    errorMessage.value = message
    phase.value = "error"
  }

  function reset(): void {
    phase.value = "idle"
    errorMessage.value = ""
  }

  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    // Signing is always the first thing that happens on every path in scope.
    errorMessage.value = ""
    phase.value = "signing"
    try {
      const result = await task()
      phase.value = "success"
      return result
    } catch (error) {
      fail(error instanceof Error ? error.message : "Something went wrong")
      return undefined
    }
  }

  return { phase, errorMessage, isBusy, markSigning, markSubmitting, applyUpdate, fail, reset, run }
}
