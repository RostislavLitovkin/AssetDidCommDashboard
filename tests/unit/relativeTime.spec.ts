// tests/unit/relativeTime.spec.ts
import { describe, expect, it } from "vitest"
import { timeAgo } from "../../app/services/format/relativeTime"

const now = Date.parse("2026-08-20T12:00:00.000Z")
const ago = (millis: number) => timeAgo(now - millis, now)

describe("timeAgo", () => {
  it("picks the largest unit that fits the gap", () => {
    expect(ago(3_000)).toBe("3 seconds ago")
    expect(ago(5 * 60_000)).toBe("5 minutes ago")
    expect(ago(2 * 3_600_000)).toBe("2 hours ago")
    expect(ago(3 * 86_400_000)).toBe("3 days ago")
    expect(ago(2 * 2_592_000_000)).toBe("2 months ago")
    expect(ago(2 * 31_536_000_000)).toBe("2 years ago")
  })

  it("keeps sub-second gaps on the seconds unit rather than falling through", () => {
    expect(ago(0)).toBe("now")
    expect(ago(400)).toBe("now")
  })

  it("defaults the reference point to the current time", () => {
    expect(timeAgo(Date.now())).toBe("now")
  })
})
