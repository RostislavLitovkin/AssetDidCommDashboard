import { afterEach, describe, expect, it, vi } from "vitest"
import { PinataStorageAdapter } from "../../app/services/storage/pinataStorageAdapter"

describe("PinataStorageAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("uploads to public network by default", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ cid: "bafy-public" })
    }))

    vi.stubGlobal("fetch", fetchMock)

    const adapter = new PinataStorageAdapter({ jwt: "jwt-token" })
    const cid = await adapter.upload("hello")

    expect(cid).toBe("bafy-public")
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const calls = fetchMock.mock.calls as unknown[][]
    expect(calls.length).toBeGreaterThan(0)
    const requestInit = (calls[0]?.[1] ?? {}) as RequestInit
    expect(requestInit.method).toBe("POST")

    const body = requestInit.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get("network")).toBe("public")
    expect(body.get("file")).toBeInstanceOf(Blob)
  })

  it("allows explicit network override", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ cid: "bafy-private" })
    }))

    vi.stubGlobal("fetch", fetchMock)

    const adapter = new PinataStorageAdapter({ jwt: "jwt-token", network: "private" })
    await adapter.upload("secret")

    const calls = fetchMock.mock.calls as unknown[][]
    expect(calls.length).toBeGreaterThan(0)
    const requestInit = (calls[0]?.[1] ?? {}) as RequestInit
    const body = requestInit.body as FormData
    expect(body.get("network")).toBe("private")
  })
})
