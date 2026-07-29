// tests/unit/useAutoGrowTextarea.spec.ts
import { describe, expect, it } from "vitest"
import { applyAutoGrow, type AutoGrowTarget } from "../../app/composables/useAutoGrowTextarea"

/**
 * Stands in for a textarea. It reports its true content height only while no
 * explicit height is pinned — exactly what the real element does, and the one
 * behaviour that makes a missing `height = "auto"` reset observable without a
 * layout engine.
 */
function stubTextarea(contentHeight: number, pinnedHeight = "200px"): AutoGrowTarget {
  const style = { height: pinnedHeight }
  return {
    style,
    get scrollHeight(): number {
      return style.height === "auto" ? contentHeight : Number.parseFloat(style.height)
    }
  }
}

describe("applyAutoGrow", () => {
  it("sizes a borderless box to exactly its content", () => {
    // .chat-input: 24px line + 20px padding, no border.
    const el = stubTextarea(44)
    applyAutoGrow(el, 0)
    expect(el.style.height).toBe("44px")
  })

  it("adds back the border that scrollHeight never counts", () => {
    // .ib-composer-input: 22px line + 16px padding reports 38, but box-sizing is
    // border-box, so the 4px border has to be paid for or the text is clipped.
    const el = stubTextarea(38)
    applyAutoGrow(el, 4)
    expect(el.style.height).toBe("42px")
  })

  it("releases the pinned height first, so the box shrinks back after a send", () => {
    // Left at three lines by the previous message, now holding one.
    const el = stubTextarea(38, "86px")
    applyAutoGrow(el, 4)
    expect(el.style.height).toBe("42px")
  })

  it("leaves the ceiling to CSS max-height rather than clamping here", () => {
    // Ten lines of text: we still ask for the full height and let the browser
    // clamp it, which is what turns overflow-y into a scrollbar.
    const el = stubTextarea(236)
    applyAutoGrow(el, 4)
    expect(el.style.height).toBe("240px")
  })

  it("treats an unmeasurable border as none instead of writing NaN", () => {
    const el = stubTextarea(44)
    applyAutoGrow(el, Number.NaN)
    expect(el.style.height).toBe("44px")
  })
})
