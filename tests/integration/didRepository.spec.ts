import { describe, expect, it } from "vitest"
import { DidRepository } from "../../app/services/papi/didRepository"

describe("DidRepository", () => {
  it("returns found record for a subject id", async () => {
    const repository = new DidRepository()
    const result = await repository.fetchDid("5F3sa2TJAWMqDhXG6jhV4N8ko9M9f7tz")
    expect(result.status).toBe("found")
    expect(result.source).toBe("did_pallet")
  })
})
