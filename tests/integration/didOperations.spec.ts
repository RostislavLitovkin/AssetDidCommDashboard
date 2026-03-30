import { describe, expect, it } from "vitest"
import { DidRepository } from "../../app/services/papi/didRepository"

describe("did write operations", () => {
  it("register returns succeeded state", async () => {
    const repository = new DidRepository()
    const result = await repository.registerDid({
      subjectId: "5F3sa2TJAWMqDhXG6jhV4N8ko9M9f7tz",
      details: { displayName: "Admin" }
    })
    expect(result.state).toBe("succeeded")
  })
})
