import { describe, expect, it } from "vitest"
import { buildX25519KeyFile } from "../../app/services/crypto/x25519KeyFile"
import type { KeyMaterial } from "../../app/types/keys"

function material(overrides: Partial<KeyMaterial> = {}): KeyMaterial {
  return {
    keyId: "1753500000000-424242",
    algorithm: "X25519",
    origin: "generated",
    publicJwk: { kty: "OKP", crv: "X25519", x: "PUBLIC_X", kid: "1753500000000-424242" },
    privateJwk: { kty: "OKP", crv: "X25519", x: "PUBLIC_X", d: "SECRET_D", kid: "1753500000000-424242" },
    canExport: true,
    validationState: "valid",
    createdAt: "2026-07-26T10:00:00.000Z",
    ...overrides
  }
}

describe("buildX25519KeyFile", () => {
  it("names the file after the key id", () => {
    expect(buildX25519KeyFile(material()).fileName).toBe("x25519-key-1753500000000-424242.json")
  })

  it("falls back to a plain name when the key id is unusable as a filename", () => {
    expect(buildX25519KeyFile(material({ keyId: "" })).fileName).toBe("x25519-key.json")
    expect(buildX25519KeyFile(material({ keyId: "../../etc/passwd" })).fileName).toBe("x25519-key.json")
  })

  it("writes both halves of the key pair as formatted JSON", () => {
    const parsed = JSON.parse(buildX25519KeyFile(material()).json)

    expect(parsed).toEqual({
      publicJwk: { kty: "OKP", crv: "X25519", x: "PUBLIC_X", kid: "1753500000000-424242" },
      privateJwk: { kty: "OKP", crv: "X25519", x: "PUBLIC_X", d: "SECRET_D", kid: "1753500000000-424242" }
    })
  })

  it("produces a payload the key loader accepts, so a generated file can be re-imported", () => {
    // Mirrors normalizeX25519SecretJwk in app/stores/settings.ts: the private
    // JWK is the candidate, and it must carry crv/kty and a non-empty d.
    const parsed = JSON.parse(buildX25519KeyFile(material()).json)

    expect(parsed.privateJwk.kty).toBe("OKP")
    expect(parsed.privateJwk.crv).toBe("X25519")
    expect(parsed.privateJwk.d).toBeTruthy()
  })

  it("refuses to build a file for a key with no private half", () => {
    expect(() => buildX25519KeyFile(material({ privateJwk: undefined }))).toThrow(/private/i)
  })
})
