import { describe, expect, it } from "vitest"
import { BucketsRepository } from "../../app/services/buckets/bucketsRepository"

const API = "https://profile-api.example"

/** Queue of canned graphql responses; captures each request body. */
function makeRepo(responses: unknown[]) {
  const requests: Array<{ query: string; variables?: Record<string, unknown> }> = []
  const repo = new BucketsRepository({
    apiUrl: API,
    fetcher: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string))
      const body = responses.shift()
      return new Response(JSON.stringify(body), { status: 200 })
    }
  })
  return { repo, requests }
}

describe("fetchNamespaces", () => {
  it("pages through the connection and maps nodes", async () => {
    const page = (ids: number[], hasNextPage: boolean, endCursor: string | null) => ({
      data: {
        namespaces: {
          nodes: ids.map((n) => ({
            id: String(n), namespaceId: String(n), name: `ns${n}`,
            schemaUri: null, properties: null, creator: "5F", createdAt: "2026-01-01T00:00:00Z"
          })),
          pageInfo: { hasNextPage, endCursor }
        }
      }
    })
    const { repo, requests } = makeRepo([page([1, 2], true, "c1"), page([3], false, null)])

    const namespaces = await repo.fetchNamespaces()

    expect(namespaces.map((n) => n.namespaceId)).toEqual(["1", "2", "3"])
    expect(requests[1]!.variables).toMatchObject({ after: "c1" })
    expect(requests[0]!.query).toContain("order: [{ createdAt: ASC }]")
  })
})

describe("fetchNamespaceById", () => {
  it("returns null for a missing namespace", async () => {
    const { repo } = makeRepo([{ data: { namespace: null } }])
    expect(await repo.fetchNamespaceById("9")).toBeNull()
  })
})

describe("fetchNamespaceManagers", () => {
  it("filters by numeric namespaceId (Long) and returns manager addresses", async () => {
    const { repo, requests } = makeRepo([
      {
        data: {
          namespaceManagers: {
            nodes: [{ manager: "5A" }, { manager: "5B" }],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    ])

    expect(await repo.fetchNamespaceManagers("7")).toEqual(["5A", "5B"])
    // Filters use the Long scalar -> JS number, not string
    expect(requests[0]!.variables).toMatchObject({ namespaceId: 7 })
  })
})

describe("fetchNamespacesByCreator", () => {
  it("filters by creator address", async () => {
    const { repo, requests } = makeRepo([
      { data: { namespaces: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }
    ])
    await repo.fetchNamespacesByCreator("5CREATOR")
    expect(requests[0]!.variables).toMatchObject({ address: "5CREATOR" })
    expect(requests[0]!.query).toContain("creator: { eq: $address }")
  })
})
