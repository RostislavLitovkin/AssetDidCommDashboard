import { describe, expect, it } from "vitest"
import { claimedServerMessageIds, withoutClaimedMessages } from "../../app/services/messages/pendingMessageReconciliation"

const MSG = (id: string) => ({ id })

describe("claimedServerMessageIds", () => {
  it("collects the server ids pending entries have claimed", () => {
    const claimed = claimedServerMessageIds([
      { serverId: "9-5" },
      { serverId: "9-6" }
    ])
    expect(claimed).toEqual(new Set(["9-5", "9-6"]))
  })

  it("ignores entries that have not been written yet", () => {
    const claimed = claimedServerMessageIds([
      { serverId: undefined },
      { serverId: null },
      { serverId: "" },
      { serverId: "9-5" }
    ])
    expect(claimed).toEqual(new Set(["9-5"]))
  })

  it("is empty when nothing is in flight", () => {
    expect(claimedServerMessageIds([])).toEqual(new Set())
  })
})

describe("withoutClaimedMessages", () => {
  // The duplicate window: the reload puts the server copy on screen while the
  // pending bubble is still showing its send status. Suppressing the claimed
  // server copy keeps exactly one bubble visible.
  it("drops the server copy while its pending bubble is still on screen", () => {
    const messages = [MSG("9-4"), MSG("9-5")]

    const visible = withoutClaimedMessages(messages, [{ serverId: "9-5" }])

    expect(visible.map(m => m.id)).toEqual(["9-4"])
  })

  it("keeps every message once no pending entry claims them", () => {
    const messages = [MSG("9-4"), MSG("9-5")]

    expect(withoutClaimedMessages(messages, []).map(m => m.id)).toEqual(["9-4", "9-5"])
    expect(withoutClaimedMessages(messages, [{ serverId: undefined }]).map(m => m.id))
      .toEqual(["9-4", "9-5"])
  })

  it("leaves the list untouched when the claimed id is not loaded yet", () => {
    const messages = [MSG("9-4")]

    expect(withoutClaimedMessages(messages, [{ serverId: "9-5" }]).map(m => m.id)).toEqual(["9-4"])
  })

  it("suppresses several concurrent sends independently", () => {
    const messages = [MSG("9-4"), MSG("9-5"), MSG("9-6")]

    const visible = withoutClaimedMessages(messages, [{ serverId: "9-4" }, { serverId: "9-6" }])

    expect(visible.map(m => m.id)).toEqual(["9-5"])
  })

  it("does not mutate the input list", () => {
    const messages = [MSG("9-4"), MSG("9-5")]

    withoutClaimedMessages(messages, [{ serverId: "9-5" }])

    expect(messages.map(m => m.id)).toEqual(["9-4", "9-5"])
  })
})
