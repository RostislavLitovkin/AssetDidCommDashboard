import { describe, expect, it } from "vitest"
import { BucketsRepository } from "../../app/services/buckets/bucketsRepository"

function makeRepo(responses: unknown[]) {
  const requests: Array<{ query: string; variables?: Record<string, unknown> }> = []
  const repo = new BucketsRepository({
    apiUrl: "https://profile-api.example",
    fetcher: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string))
      return new Response(JSON.stringify(responses.shift()), { status: 200 })
    }
  })
  return { repo, requests }
}

describe("fetchMyBuckets", () => {
  it("returns one page with client-side role flags and totalCount", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          buckets: {
            totalCount: 41,
            nodes: [{
              id: "12", bucketId: "12", namespaceId: "3", name: "chat",
              admins: [{ subjectId: "5ME" }],
              contributors: [{ subjectId: "5OTHER" }],
              viewers: [{ viewerId: "0xmykey" }]
            }],
            pageInfo: { hasNextPage: true, endCursor: "c2" }
          }
        }
      }
    ])

    const page = await repo.fetchMyBuckets("5ME", "0xmykey", { first: 20 })

    expect(page.totalCount).toBe(41)
    expect(page.hasNextPage).toBe(true)
    expect(page.endCursor).toBe("c2")
    expect(page.nodes[0]).toMatchObject({
      bucketId: "12", isAdmin: true, isContributor: false, isViewer: true
    })
    expect(requests[0]!.query).toContain("or: [")
    expect(requests[0]!.variables).toMatchObject({ address: "5ME", viewerKey: "0xmykey", first: 20 })
  })
})
