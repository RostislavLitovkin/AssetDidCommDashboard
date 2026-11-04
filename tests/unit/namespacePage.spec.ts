import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const pageSource = readFileSync(
  fileURLToPath(new URL("../../app/pages/messages/namespace/[namespaceId].vue", import.meta.url)),
  "utf8"
)

describe("namespace bucket cards", () => {
  it("loads and displays each bucket's latest message time instead of its bucket ID", () => {
    expect(pageSource).toContain("fetchLatestMessageTimes")
    expect(pageSource).toContain("timeAgo")
    expect(pageSource).toContain("Last message: {{ formatLastMessage(bucket) }}")
    expect(pageSource).not.toContain("Bucket ID: {{ bucket.id }}")
  })
})
