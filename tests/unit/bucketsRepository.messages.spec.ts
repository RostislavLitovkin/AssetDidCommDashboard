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

const MSG = (n: number) => ({
  id: `12-${n}`, messageId: String(n), contributor: "5B", reference: "cid",
  tag: null, description: null, contentType: "text/plain;charset=utf-8",
  contentHash: "0xh", ipfsContent: "cipher", createdAt: `2026-01-0${n}T00:00:00Z`,
  bucket: { bucketId: "12" }
})

describe("fetchMessages", () => {
  it("filters via the nested bucket relation and flattens bucketId", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          messages: {
            nodes: [MSG(1), MSG(2)],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    ])

    const messages = await repo.fetchMessages("12")
    expect(messages).toHaveLength(2)
    expect(messages[0]!.bucketId).toBe("12")
    expect(requests[0]!.query).toContain("bucket: { bucketId: { eq: $bucketId } }")
    expect(requests[0]!.query).toContain("order: [{ createdAt: ASC }]")
    expect(requests[0]!.variables).toMatchObject({ bucketId: 12 })
  })
})

describe("fetchMessagesByTag", () => {
  it("adds the tag filter", async () => {
    const { repo, requests } = makeRepo([
      { data: { messages: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }
    ])
    await repo.fetchMessagesByTag("12", "didcomm/key-sharing-v1")
    expect(requests[0]!.query).toContain("tag: { eq: $tag }")
    expect(requests[0]!.variables).toMatchObject({ tag: "didcomm/key-sharing-v1" })
  })
})

describe("fetchFileMessagesPage", () => {
  it("excludes text and key-sharing content types, newest first, one page", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          messages: {
            nodes: [{ ...MSG(2), contentType: "image/png" }],
            pageInfo: { hasNextPage: true, endCursor: "c9" }
          }
        }
      }
    ])

    const page = await repo.fetchFileMessagesPage("12", { first: 10 })
    expect(page.hasNextPage).toBe(true)
    expect(page.endCursor).toBe("c9")
    expect(requests[0]!.query).toContain("neq: null")
    expect(requests[0]!.query).toContain("order: [{ createdAt: DESC }]")
    expect(requests[0]!.variables).toMatchObject({ first: 10 })
  })
})

describe("fetchLatestMessageTimes", () => {
  it("batches per-bucket newest-message queries into one aliased document", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          b0: { nodes: [{ createdAt: "2026-02-01T00:00:00Z" }] },
          b1: { nodes: [] }
        }
      }
    ])

    const times = await repo.fetchLatestMessageTimes(["5", "9"])
    expect(times).toEqual({ "5": "2026-02-01T00:00:00Z" })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.query).toContain("b0:")
    expect(requests[0]!.query).toContain("b1:")
  })

  it("returns empty for no ids without calling the API", async () => {
    const { repo, requests } = makeRepo([])
    expect(await repo.fetchLatestMessageTimes([])).toEqual({})
    expect(requests).toHaveLength(0)
  })
})
