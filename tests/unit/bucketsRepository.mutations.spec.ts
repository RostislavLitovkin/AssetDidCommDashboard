// tests/unit/bucketsRepository.mutations.spec.ts
import { describe, expect, it } from "vitest"
import { BucketsRepository } from "../../app/services/buckets/bucketsRepository"
import type { OperationUpdate } from "../../app/services/buckets/types"

function makeRepo(responses: unknown[]) {
  const requests: Array<{ query: string; variables?: Record<string, unknown> }> = []
  const signed: Array<{ address: string; rawBody: string }> = []
  const repo = new BucketsRepository({
    apiUrl: "https://profile-api.example",
    sign: async (address, rawBody) => {
      signed.push({ address, rawBody })
      return { "X-SS58-Address": address, "X-Signature": "0xsig", "X-Timestamp": "t" }
    },
    fetcher: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string))
      return new Response(JSON.stringify(responses.shift()), { status: 200 })
    }
  })
  return { repo, requests, signed }
}

describe("createNamespace", () => {
  it("signs as owner and sends metadata", async () => {
    const { repo, requests, signed } = makeRepo([
      { data: { createNamespace: { id: "4", namespaceId: "4" } } }
    ])
    const updates: OperationUpdate[] = []

    const result = await repo.createNamespace("my ns", "5OWNER", (u) => updates.push(u))

    expect(result).toEqual({ id: "4", method: "createNamespace" })
    expect(signed[0]!.address).toBe("5OWNER")
    expect(requests[0]!.variables).toMatchObject({
      metadata: { name: "my ns", schemaUri: null, properties: [] }
    })
    expect(updates.map((u) => u.stage)).toEqual(["pending", "success"])
  })

  it("emits error and rethrows on failure", async () => {
    const { repo } = makeRepo([{ errors: [{ message: "denied" }] }])
    const updates: OperationUpdate[] = []
    await expect(repo.createNamespace("x", "5OWNER", (u) => updates.push(u))).rejects.toThrow("denied")
    expect(updates.map((u) => u.stage)).toEqual(["pending", "error"])
  })

  it("rejects without an owner address", async () => {
    const { repo } = makeRepo([])
    await expect(repo.createNamespace("x", "")).rejects.toThrow(/wallet/i)
  })
})

describe("createBucket", () => {
  it("sends namespaceId as a BigInt string and defaults category to empty string", async () => {
    const { repo, requests } = makeRepo([{ data: { createBucket: { id: "9", bucketId: "9" } } }])
    const result = await repo.createBucket("3", "chat", "5OWNER")
    expect(result).toEqual({ id: "9", method: "createBucket" })
    expect(requests[0]!.variables).toMatchObject({
      namespaceId: "3",
      metadata: { name: "chat", category: "", properties: [] }
    })
  })
})

describe("member and manager mutations", () => {
  it("removeBucketAdmin sends string ids and the member address", async () => {
    const { repo, requests } = makeRepo([{ data: { removeAdmin: true } }])
    await repo.removeBucketAdmin("3", "9", "5X", "5OWNER")
    expect(requests[0]!.query).toContain("removeAdmin")
    expect(requests[0]!.variables).toMatchObject({ namespaceId: "3", bucketId: "9", admin: "5X" })
  })

  it("addNamespaceManager maps to addManager", async () => {
    const { repo, requests } = makeRepo([{ data: { addManager: { id: "3-5X" } } }])
    const result = await repo.addNamespaceManager("3", "5X", "5OWNER")
    expect(result.method).toBe("addManager")
    expect(requests[0]!.variables).toMatchObject({ namespaceId: "3", newManager: "5X" })
  })
})

describe("setBucketPublicKey", () => {
  it("maps to resumeWriting with a normalized 32-byte key", async () => {
    const { repo, requests } = makeRepo([{ data: { resumeWriting: { id: "9" } } }])
    const hex = "0x" + "ab".repeat(32)
    await repo.setBucketPublicKey("3", "9", hex, "5OWNER")
    expect(requests[0]!.query).toContain("resumeWriting")
    expect(requests[0]!.variables).toMatchObject({ newEncryptionKey: hex })
  })
})
