import { describe, expect, it } from "vitest"
import { X25519KeyService } from "../../app/services/crypto/x25519KeyService"

describe("key import and export", () => {
  it("exports and imports generated key", async () => {
    const service = new X25519KeyService()
    const generated = await service.generate()
    const exported = service.export(generated)
    const imported = service.import(exported)
    expect(imported.algorithm).toBe("X25519")
  })
})
