import { describe, expect, it, vi } from "vitest"
import { BucketsRepository } from "../../app/services/buckets/bucketsRepository"

vi.mock("../../app/services/storage/pinataStorageAdapter", () => ({
  PinataStorageAdapter: class {
    async upload(): Promise<string> {
      return "bafyCID"
    }
  }
}))

function makeRepo(responses: unknown[]) {
  const requests: Array<{ query: string; variables?: Record<string, unknown> }> = []
  const repo = new BucketsRepository({
    apiUrl: "https://profile-api.example",
    pinataConfig: { jwt: "test" },
    sign: async (address) => ({ "X-SS58-Address": address }),
    fetcher: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string))
      return new Response(JSON.stringify(responses.shift()), { status: 200 })
    }
  })
  return { repo, requests }
}

const BUCKET_RESPONSE = {
  data: {
    buckets: {
      nodes: [{
        id: "9", bucketId: "9", namespaceId: "3", creator: "5F", name: "chat",
        category: null, isWritable: true, encryptionKey: "0xabc",
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z"
      }],
      pageInfo: { hasNextPage: false, endCursor: null }
    }
  }
}

describe("createMessage", () => {
  it("uploads to Pinata, resolves namespaceId, and mirrors content into ipfsContent", async () => {
    const { repo, requests } = makeRepo([
      BUCKET_RESPONSE,
      { data: { write: { id: "9-5", messageId: "5" } } }
    ])

    const result = await repo.createMessage("9", "cipher-text", "5OWNER")

    expect(result).toEqual({ id: "9-5", method: "write" })
    const writeReq = requests[1]!
    expect(writeReq.variables).toMatchObject({
      namespaceId: "3",
      bucketId: "9",
      message: {
        reference: "bafyCID",
        tag: null,
        ipfsContent: "cipher-text",
        metadata: {
          description: "",
          contentType: "text/plain;charset=utf-8",
          properties: []
        }
      }
    })
    const metadata = (writeReq.variables!.message as { metadata: { contentHash: string } }).metadata
    expect(metadata.contentHash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it("caches namespaceId per bucket across sends", async () => {
    const { repo, requests } = makeRepo([
      BUCKET_RESPONSE,
      { data: { write: { id: "9-5" } } },
      { data: { write: { id: "9-6" } } }
    ])
    await repo.createMessage("9", "a", "5OWNER")
    await repo.createMessage("9", "b", "5OWNER")
    expect(requests).toHaveLength(3) // bucket lookup only once
  })

  it("uses the key-sharing content type for the key-sharing tag", async () => {
    const { repo, requests } = makeRepo([
      BUCKET_RESPONSE,
      { data: { write: { id: "9-7" } } }
    ])
    await repo.createMessage("9", "jwe", "5OWNER", undefined, "didcomm/key-sharing-v1")
    const message = requests[1]!.variables!.message as { metadata: { contentType: string }; tag: string }
    expect(message.tag).toBe("didcomm/key-sharing-v1")
    expect(message.metadata.contentType).toBe("application/didcomm-encrypted+json")
  })
})

describe("rotateBucketKeyAndShare", () => {
  // resumeWriting, not rotateKey: fresh buckets are born Locked and rotateKey
  // refuses locked buckets, so the first key of a new bucket can only be set
  // through resumeWriting (which also works on writable buckets).
  it("sends resumeWriting and write in ONE signed document", async () => {
    const { repo, requests } = makeRepo([
      { data: { resumeWriting: { id: "9" }, write: { id: "9-8", messageId: "8" } } }
    ])

    const result = await repo.rotateBucketKeyAndShare(
      "3", "9", "0x" + "ab".repeat(32), "didcomm/key-sharing-v1", "jwe", "5OWNER"
    )

    expect(result.method).toBe("resumeWriting+write")
    expect(requests).toHaveLength(1)
    expect(requests[0]!.query).toContain("resumeWriting")
    expect(requests[0]!.query).not.toContain("rotateKey")
    expect(requests[0]!.query).toContain("write")
  })

  it("rejects when resumeWriting result is missing", async () => {
    const { repo } = makeRepo([
      { data: { write: { id: "9-8", messageId: "8" } } }
    ])

    await expect(
      repo.rotateBucketKeyAndShare("3", "9", "0x" + "ab".repeat(32), "didcomm/key-sharing-v1", "jwe", "5OWNER")
    ).rejects.toThrow(/resumeWriting reported no result/)
  })
})

describe("addBucketMemberWithRole", () => {
  // Admins also get the contributor role: the API's write check (a faithful
  // pallet port) accepts only contributors, and the dashboard expects admins
  // to write messages — the key-sharing message included.
  it("admin role sends addAdmin, addContributor and addViewer in one document", async () => {
    const { repo, requests } = makeRepo([
      { data: { addAdmin: { id: "x" }, addContributor: { id: "c" }, addViewer: { id: "y" } } }
    ])
    const jwkX = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"

    await repo.addBucketMemberWithRole("admin", "3", "9", "5NEW", jwkX, "5OWNER")

    expect(requests).toHaveLength(1)
    expect(requests[0]!.query).toContain("addAdmin")
    expect(requests[0]!.query).toContain("addContributor")
    expect(requests[0]!.query).toContain("addViewer")
    const vars = requests[0]!.variables!
    expect(vars.subject).toBe("5NEW")
    expect(String(vars.viewerKey)).toMatch(/^0x[0-9a-f]{64}$/i)
  })

  it("rejects when one of the admin-role results is missing", async () => {
    const { repo } = makeRepo([
      { data: { addAdmin: { id: "x" }, addViewer: { id: "y" } } }
    ])
    const jwkX = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"

    await expect(
      repo.addBucketMemberWithRole("admin", "3", "9", "5NEW", jwkX, "5OWNER")
    ).rejects.toThrow(/addContributor reported no result/)
  })

  it("viewer role sends only addViewer", async () => {
    const { repo, requests } = makeRepo([{ data: { addViewer: { id: "y" } } }])
    const jwkX = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
    await repo.addBucketMemberWithRole("viewer", "3", "9", "5NEW", jwkX, "5OWNER")
    expect(requests[0]!.query).toContain("addViewer")
    expect(requests[0]!.query).not.toContain("addAdmin")
  })

  it("contributor role sends addContributor and addViewer in one document", async () => {
    const { repo, requests } = makeRepo([
      { data: { addContributor: { id: "x" }, addViewer: { id: "y" } } }
    ])
    const jwkX = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"

    await repo.addBucketMemberWithRole("contributor", "3", "9", "5NEW", jwkX, "5OWNER")

    expect(requests).toHaveLength(1)
    expect(requests[0]!.query).toContain("addContributor")
    expect(requests[0]!.query).toContain("addViewer")
    expect(requests[0]!.query).not.toContain("addAdmin")
    const vars = requests[0]!.variables!
    expect(vars.subject).toBe("5NEW")
    expect(String(vars.viewerKey)).toMatch(/^0x[0-9a-f]{64}$/i)
  })
})

describe("removeBucketMemberRoles", () => {
  it("builds a document with only the requested roles", async () => {
    const { repo, requests } = makeRepo([
      { data: { removeContributor: true, removeViewer: true } }
    ])
    await repo.removeBucketMemberRoles(
      "3", "9", "5X", ["contributor", "viewer"], "0x" + "cd".repeat(32), "5OWNER"
    )
    expect(requests[0]!.query).toContain("removeContributor")
    expect(requests[0]!.query).toContain("removeViewer")
    expect(requests[0]!.query).not.toContain("removeAdmin")
  })

  it("requires a viewer key when removing the viewer role", async () => {
    const { repo } = makeRepo([])
    await expect(
      repo.removeBucketMemberRoles("3", "9", "5X", ["viewer"], undefined, "5OWNER")
    ).rejects.toThrow(/viewer key/i)
  })

  it("rejects with an empty roles array", async () => {
    const { repo } = makeRepo([])
    await expect(
      repo.removeBucketMemberRoles("3", "9", "5X", [], undefined, "5OWNER")
    ).rejects.toThrow("At least one role is required")
  })

  it("rejects when a requested role removal reports false", async () => {
    const { repo } = makeRepo([
      { data: { removeContributor: false, removeViewer: true } }
    ])
    await expect(
      repo.removeBucketMemberRoles("3", "9", "5X", ["contributor", "viewer"], "0x" + "cd".repeat(32), "5OWNER")
    ).rejects.toThrow(/removeContributor reported no change/)
  })
})
