import { afterEach, describe, expect, it, vi } from "vitest"
import {
  fetchIndexedBucketsByNamespace,
  fetchIndexedNamespaceManagers,
  fetchIndexedNamespaces
} from "../../app/services/indexer/subqueryClient"

function getRequestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls[0] as unknown[] | undefined
  const requestInit = call?.[1] as RequestInit | undefined
  return JSON.parse(String(requestInit?.body)) as Record<string, unknown>
}

describe("subqueryClient", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("loads namespaces using latest schema fields and list ordering", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          namespaces: {
            nodes: [
              {
                id: "7",
                namespaceId: 7,
                name: "Property namespace",
                schemaUri: "ipfs://schema",
                properties: "{}",
                createdAt: 7055,
                creator: "5Creator"
              }
            ],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      })
    }))
    vi.stubGlobal("fetch", fetchMock)

    const namespaces = await fetchIndexedNamespaces("https://indexer.example/graphql", "CREATED_AT_ASC")

    expect(namespaces).toHaveLength(1)
    expect(namespaces[0]).toMatchObject({ id: "7", namespaceId: 7, createdAt: 7055, creator: "5Creator" })

    const body = getRequestBody(fetchMock) as { variables: { orderBy: string[] } }
    expect(body.variables.orderBy).toEqual(["CREATED_AT_ASC"])
  })

  it("loads namespace managers from the latest manager field", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          namespaceManagers: {
            nodes: [{ id: "7-5Manager", namespaceId: "7", manager: "5Manager", addedBlock: 7055 }],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      })
    }))
    vi.stubGlobal("fetch", fetchMock)

    const managers = await fetchIndexedNamespaceManagers("https://indexer.example/graphql", "7")

    expect(managers).toEqual([{ id: "7-5Manager", namespaceId: "7", manager: "5Manager", addedBlock: 7055 }])
  })

  it("loads buckets by numeric namespace id and normalizes relation counts", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          buckets: {
            nodes: [
              {
                id: "7-2",
                namespaceId: 7,
                bucketId: 2,
                creator: "5Creator",
                name: "Messages",
                category: null,
                isWritable: true,
                encryptionKey: null,
                createdBlock: 7100,
                admins: { totalCount: 1 },
                contributors: { totalCount: 3 }
              }
            ],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      })
    }))
    vi.stubGlobal("fetch", fetchMock)

    const buckets = await fetchIndexedBucketsByNamespace("https://indexer.example/graphql", "7")

    expect(buckets[0]).toMatchObject({ id: "7-2", namespaceId: 7, adminCount: 1, contributorCount: 3 })

    const body = getRequestBody(fetchMock) as { variables: { namespaceId: number } }
    expect(body.variables.namespaceId).toBe(7)
  })
})