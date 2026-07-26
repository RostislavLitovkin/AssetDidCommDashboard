import { describe, expect, it } from "vitest"
import { BucketsApiError, BucketsGraphqlClient } from "../../app/services/buckets/bucketsApiClient"

const API = "https://profile-api.example"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

describe("BucketsGraphqlClient.query", () => {
  it("POSTs the document to {apiUrl}/graphql and returns data", async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const client = new BucketsGraphqlClient(API, async (url, init) => {
      captured = { url: String(url), init: init! }
      return jsonResponse({ data: { namespaces: { nodes: [] } } })
    })

    const data = await client.query<{ namespaces: { nodes: unknown[] } }>(
      "query { namespaces { nodes { id } } }"
    )

    expect(data.namespaces.nodes).toEqual([])
    expect(captured!.url).toBe(`${API}/graphql`)
    expect(captured!.init.method).toBe("POST")
    const sent = JSON.parse(captured!.init.body as string)
    expect(sent.query).toContain("namespaces")
    // No auth headers on queries
    const headers = captured!.init.headers as Record<string, string>
    expect(headers["X-SS58-Address"]).toBeUndefined()
  })

  it("throws BucketsApiError with joined messages on graphql errors", async () => {
    const client = new BucketsGraphqlClient(API, async () =>
      jsonResponse({ errors: [{ message: "boom" }, { message: "bang" }] })
    )
    await expect(client.query("query { x }")).rejects.toThrow("boom; bang")
  })

  it("throws BucketsApiError with status on non-ok http", async () => {
    const client = new BucketsGraphqlClient(API, async () => jsonResponse({}, 500))
    const err = await client.query("query { x }").catch((e) => e)
    expect(err).toBeInstanceOf(BucketsApiError)
    expect(err.status).toBe(500)
  })

  it("throws when data is missing", async () => {
    const client = new BucketsGraphqlClient(API, async () => jsonResponse({}))
    await expect(client.query("query { x }")).rejects.toThrow(/no data/i)
  })
})

describe("BucketsGraphqlClient.mutate", () => {
  it("signs the exact bytes it sends and attaches the returned headers", async () => {
    let sentBody = ""
    let sentHeaders: Record<string, string> = {}
    const client = new BucketsGraphqlClient(API, async (_url, init) => {
      sentBody = init!.body as string
      sentHeaders = init!.headers as Record<string, string>
      return jsonResponse({ data: { createTag: { id: "1-x" } } })
    })

    let signedBody = ""
    const data = await client.mutate<{ createTag: { id: string } }>(
      "mutation CreateTag($bucketId: BigInt!, $newTag: String!) { createTag(bucketId: $bucketId, newTag: $newTag) { id } }",
      { bucketId: "1", newTag: "x" },
      async (rawBody) => {
        signedBody = rawBody
        return { "X-SS58-Address": "5F...", "X-Signature": "0xsig", "X-Timestamp": "t" }
      }
    )

    expect(data.createTag.id).toBe("1-x")
    expect(signedBody).toBe(sentBody) // exact-bytes contract
    expect(sentHeaders["X-Signature"]).toBe("0xsig")
    expect(sentHeaders["Content-Type"]).toBe("application/json")
  })

  it("maps 401 to a signature-rejected message", async () => {
    const client = new BucketsGraphqlClient(API, async () => jsonResponse({}, 401))
    await expect(
      client.mutate("mutation { x }", undefined, async () => ({}))
    ).rejects.toThrow(/signature rejected/i)
  })
})
