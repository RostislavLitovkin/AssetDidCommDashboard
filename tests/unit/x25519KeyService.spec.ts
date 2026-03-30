import { describe, expect, it } from "vitest"
import { X25519KeyService } from "../../app/services/crypto/x25519KeyService"

describe("X25519KeyService", () => {
  it("generates a valid key material object", async () => {
    const service = new X25519KeyService()
    const key = await service.generate()
    expect(key.algorithm).toBe("X25519")
    expect(key.validationState).toBe("valid")
  })
})
