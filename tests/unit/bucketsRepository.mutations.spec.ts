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
    expect(updates.map((u) => u.stage)).toEqual(["signing", "submitting", "success"])
  })

  it("emits error and rethrows on failure", async () => {
    const { repo } = makeRepo([{ errors: [{ message: "denied" }] }])
    const updates: OperationUpdate[] = []
    await expect(repo.createNamespace("x", "5OWNER", (u) => updates.push(u))).rejects.toThrow("denied")
    expect(updates.map((u) => u.stage)).toEqual(["signing", "submitting", "error"])
  })

  it("rejects without an owner address", async () => {
    const { repo } = makeRepo([])
    await expect(repo.createNamespace("x", "")).rejects.toThrow(/wallet/i)
  })

  it("emits signing before the signature resolves and submitting after", async () => {
    const order: string[] = []
    let releaseSignature: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      releaseSignature = resolve
    })

    const repo = new BucketsRepository({
      apiUrl: "https://profile-api.example",
      sign: async (address) => {
        order.push("sign-start")
        await held
        order.push("sign-end")
        return { "X-SS58-Address": address, "X-Signature": "0xsig", "X-Timestamp": "t" }
      },
      fetcher: async () => {
        order.push("fetch")
        return new Response(JSON.stringify({ data: { createNamespace: { id: "4", namespaceId: "4" } } }), { status: 200 })
      }
    })

    const updates: OperationUpdate[] = []
    const pending = repo.createNamespace("my ns", "5OWNER", (u) => {
      order.push(`stage:${u.stage}`)
      updates.push(u)
    })

    // The signing update must already be out while the wallet is still open.
    await Promise.resolve()
    expect(updates.map((u) => u.stage)).toEqual(["signing"])

    releaseSignature()
    await pending

    expect(order).toEqual([
      "stage:signing", "sign-start", "sign-end", "stage:submitting", "fetch", "stage:success"
    ])
  })

  it("emits signing then error and never submitting when the signature is rejected", async () => {
    const repo = new BucketsRepository({
      apiUrl: "https://profile-api.example",
      sign: async () => {
        throw new Error("User rejected the signature")
      },
      fetcher: async () => new Response("{}", { status: 200 })
    })

    const updates: OperationUpdate[] = []
    await expect(repo.createNamespace("x", "5OWNER", (u) => updates.push(u))).rejects.toThrow(
      "User rejected the signature"
    )
    expect(updates.map((u) => u.stage)).toEqual(["signing", "error"])
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

  it("sends a null namespaceId for standalone buckets via a nullable variable", async () => {
    const { repo, requests } = makeRepo([{ data: { createBucket: { id: "9", bucketId: "9" } } }])
    const result = await repo.createBucket(null, "chat", "5OWNER", undefined, "comms")
    expect(result).toEqual({ id: "9", method: "createBucket" })
    expect(requests[0]!.query).toContain("$namespaceId: BigInt,")
    expect(requests[0]!.variables).toMatchObject({
      namespaceId: null,
      metadata: { name: "chat", category: "comms", properties: [] }
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

  it("removeBucketAdmin rejects and emits signing→submitting→error when the API returns false", async () => {
    const { repo } = makeRepo([{ data: { removeAdmin: false } }])
    const updates: OperationUpdate[] = []
    await expect(repo.removeBucketAdmin("3", "9", "5X", "5OWNER", (u) => updates.push(u))).rejects.toThrow(
      "removeAdmin reported no change"
    )
    expect(updates.map((u) => u.stage)).toEqual(["signing", "submitting", "error"])
  })

  it("removeBucketContributor sends string ids and the member address", async () => {
    const { repo, requests } = makeRepo([{ data: { removeContributor: true } }])
    await repo.removeBucketContributor("3", "9", "5X", "5OWNER")
    expect(requests[0]!.query).toContain("removeContributor")
    expect(requests[0]!.variables).toMatchObject({ namespaceId: "3", bucketId: "9", contributor: "5X" })
  })

  it("removeBucketViewer normalizes the viewer key to 0x-hex", async () => {
    const { repo, requests } = makeRepo([{ data: { removeViewer: true } }])
    const jwkX = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
    await repo.removeBucketViewer("3", "9", jwkX, "5OWNER")
    expect(requests[0]!.query).toContain("removeViewer")
    const vars = requests[0]!.variables!
    expect(vars).toMatchObject({ namespaceId: "3", bucketId: "9" })
    expect(String(vars.viewer)).toMatch(/^0x[0-9a-f]{64}$/i)
  })

  it("addNamespaceManager maps to addManager", async () => {
    const { repo, requests } = makeRepo([{ data: { addManager: { id: "3-5X" } } }])
    const result = await repo.addNamespaceManager("3", "5X", "5OWNER")
    expect(result.method).toBe("addManager")
    expect(requests[0]!.variables).toMatchObject({ namespaceId: "3", newManager: "5X" })
  })

  it("removeNamespaceManager resolves when the API returns true", async () => {
    const { repo, requests } = makeRepo([{ data: { removeManager: true } }])
    const result = await repo.removeNamespaceManager("3", "5X", "5OWNER")
    expect(result).toEqual({ id: "5X", method: "removeManager" })
    expect(requests[0]!.query).toContain("removeManager")
    expect(requests[0]!.variables).toMatchObject({ namespaceId: "3", oldManager: "5X" })
  })

  it("removeNamespaceManager rejects when the API returns false", async () => {
    const { repo } = makeRepo([{ data: { removeManager: false } }])
    const updates: OperationUpdate[] = []
    await expect(repo.removeNamespaceManager("3", "5X", "5OWNER", (u) => updates.push(u))).rejects.toThrow(
      "removeManager reported no change"
    )
    expect(updates.map((u) => u.stage)).toEqual(["signing", "submitting", "error"])
  })
})

describe("createTag", () => {
  it("sends bucketId and newTag as strings", async () => {
    const { repo, requests } = makeRepo([{ data: { createTag: { id: "9-tag" } } }])
    const result = await repo.createTag("9", "my-tag", "5OWNER")
    expect(result).toEqual({ id: "9-tag", method: "createTag" })
    expect(requests[0]!.query).toContain("createTag")
    expect(requests[0]!.variables).toMatchObject({ bucketId: "9", newTag: "my-tag" })
    expect(typeof requests[0]!.variables!.bucketId).toBe("string")
    expect(typeof requests[0]!.variables!.newTag).toBe("string")
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
