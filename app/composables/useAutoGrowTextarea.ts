import { getCurrentScope, onScopeDispose, watch, type Ref } from "vue"

/** The slice of a textarea the sizer touches, so the measurement stays testable
 *  without a layout engine. */
export interface AutoGrowTarget {
  style: { height: string }
  readonly scrollHeight: number
}

/**
 * Size a textarea to exactly fit the text it holds.
 *
 * Two details the browser will not forgive:
 *  - the height is released to `auto` before measuring, because `scrollHeight`
 *    on a height-pinned textarea reports the pinned box rather than the
 *    content — without the reset the composer grows but never shrinks back;
 *  - `scrollHeight` spans content and padding but never the border, and
 *    `box-sizing: border-box` is global here, so the border has to be added
 *    back or the box renders short of its own text.
 *
 * The ceiling is deliberately left to CSS `max-height`: the browser clamps
 * whatever we set here and `overflow-y: auto` turns the excess into a
 * scrollbar, so nothing in this file needs to know how many lines are allowed.
 */
export function applyAutoGrow(el: AutoGrowTarget, borderY: number): void {
  el.style.height = "auto"
  const border = Number.isFinite(borderY) ? borderY : 0
  el.style.height = `${el.scrollHeight + border}px`
}

function verticalBorder(el: HTMLElement): number {
  const style = getComputedStyle(el)
  return Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth)
}

/**
 * Keep `elRef` sized to `value` as it is typed.
 *
 * The element is watched alongside the value because the composers swap the
 * textarea out for an attachment chip and back, which replaces the node.
 */
export function useAutoGrowTextarea(elRef: Ref<HTMLTextAreaElement | null>, value: () => string): void {
  function resize(): void {
    const el = elRef.value
    if (el) applyAutoGrow(el, verticalBorder(el))
  }

  // `post` so the textarea has taken the new value before it gets measured.
  watch([elRef, value], resize, { flush: "post", immediate: true })

  if (typeof window === "undefined") return

  // Rewrapping at a new width changes the line count, which would otherwise
  // strand text outside a box that is no longer tall enough to show it.
  window.addEventListener("resize", resize)
  if (getCurrentScope()) onScopeDispose(() => window.removeEventListener("resize", resize))
}
