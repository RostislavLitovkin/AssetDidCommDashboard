import { describe, expect, it } from "vitest"
import { BucketsRepository } from "../../app/services/buckets/bucketsRepository"

const API = "https://profile-api.example"

function makeRepo(responses: unknown[]) {
  const requests: Array<{ query: string; variables?: Record<string, unknown> }> = []
  const repo = new BucketsRepository({
    apiUrl: API,
    fetcher: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string))
      return new Response(JSON.stringify(responses.shift()), { status: 200 })
    }
  })
  return { repo, requests }
}

const BUCKET_NODE = {
  id: "12", bucketId: "12", namespaceId: "3", creator: "5F", name: "chat",
  category: null, isWritable: true, encryptionKey: "0xabc",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z"
}

describe("fetchBucketsByNamespace", () => {
  it("maps nested member lists to address arrays", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          buckets: {
            nodes: [{
              ...BUCKET_NODE,
              admins: [{ subjectId: "5A" }],
              contributors: [{ subjectId: "5B" }, { subjectId: "5C" }]
            }],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    ])

    const buckets = await repo.fetchBucketsByNamespace("3")
    expect(buckets[0]!.admins).toEqual(["5A"])
    expect(buckets[0]!.contributors).toEqual(["5B", "5C"])
    expect(requests[0]!.variables).toMatchObject({ namespaceId: 3 })
  })
})

describe("fetchBucket", () => {
  it("queries by numeric bucketId and returns the single node", async () => {
    const { repo, requests } = makeRepo([
      { data: { buckets: { nodes: [BUCKET_NODE], pageInfo: { hasNextPage: false, endCursor: null } } } }
    ])
    const bucket = await repo.fetchBucket("12")
    expect(bucket?.name).toBe("chat")
    expect(requests[0]!.variables).toMatchObject({ bucketId: 12 })
  })

  it("returns null when no bucket matches", async () => {
    const { repo } = makeRepo([
      { data: { buckets: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }
    ])
    expect(await repo.fetchBucket("999")).toBeNull()
  })
})

describe("fetchBucketDetail", () => {
  it("flattens members and messages", async () => {
    const { repo } = makeRepo([
      {
        data: {
          bucket: {
            ...BUCKET_NODE,
            admins: [{ subjectId: "5A" }],
            contributors: [],
            viewers: [{ viewerId: "0xkey" }],
            messages: [{
              id: "12-1", messageId: "1", contributor: "5B", reference: "cid",
              tag: null, description: null, contentType: "text/plain;charset=utf-8",
              contentHash: "0xh", ipfsContent: "cipher", createdAt: "2026-01-03T00:00:00Z"
            }]
          }
        }
      }
    ])

    const detail = await repo.fetchBucketDetail("12")
    expect(detail!.admins).toEqual(["5A"])
    expect(detail!.viewers).toEqual(["0xkey"])
    expect(detail!.messages[0]!.bucketId).toBe("12")
  })

  it("returns null for a missing bucket", async () => {
    const { repo } = makeRepo([{ data: { bucket: null } }])
    expect(await repo.fetchBucketDetail("999")).toBeNull()
  })
})

describe("member address lists", () => {
  it("fetchBucketAdmins uses the bucketAdmins root query", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          bucketAdmins: {
            nodes: [{ subjectId: "5A" }],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    ])
    expect(await repo.fetchBucketAdmins("12")).toEqual(["5A"])
    expect(requests[0]!.query).toContain("bucketAdmins")
  })

  it("fetchBucketContributors uses the bucketContributors root query and maps to subjectId strings", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          bucketContributors: {
            nodes: [{ subjectId: "5B" }, { subjectId: "5C" }],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    ])
    const contributors = await repo.fetchBucketContributors("12")
    expect(contributors).toEqual(["5B", "5C"])
    expect(requests[0]!.query).toContain("bucketContributors")
  })

  it("fetchBucketViewers uses the bucketViewers root query and maps to viewerId strings", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          bucketViewers: {
            nodes: [{ viewerId: "0xkey1" }, { viewerId: "0xkey2" }],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    ])
    const viewers = await repo.fetchBucketViewers("12")
    expect(viewers).toEqual(["0xkey1", "0xkey2"])
    expect(requests[0]!.query).toContain("bucketViewers")
  })
})
