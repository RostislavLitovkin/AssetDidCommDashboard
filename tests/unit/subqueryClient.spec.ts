import { afterEach, describe, expect, it, vi } from "vitest"
import {
  fetchFileMessagesPage,
  fetchIndexedBucketsByNamespace,
  fetchIndexedNamespaceManagers,
  fetchIndexedNamespaces,
  isFileMessage
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

  it("fetches a single page of file messages and returns its cursor info", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          messages: {
            nodes: [
              {
                id: "3-5",
                bucketId: "3",
                messageId: 5,
                contributor: "5Sender",
                reference: "bafyFileCid",
                tag: null,
                description: null,
                contentType: "image/png",
                contentHash: null,
                createdBlock: 7200,
                ipfsContent: null
              }
            ],
            pageInfo: { hasNextPage: true, endCursor: "cursor-2" }
          }
        }
      })
    }))
    vi.stubGlobal("fetch", fetchMock)

    const page = await fetchFileMessagesPage("https://indexer.example/graphql", "3", { first: 20, after: "cursor-1" })

    expect(page.nodes).toHaveLength(1)
    expect(page.nodes[0]).toMatchObject({ id: "3-5", contentType: "image/png" })
    expect(page.hasNextPage).toBe(true)
    expect(page.endCursor).toBe("cursor-2")

    const body = getRequestBody(fetchMock) as { query: string; variables: { bucketId: string; first: number; after: string } }
    expect(body.variables.bucketId).toBe("3")
    expect(body.variables.first).toBe(20)
    expect(body.variables.after).toBe("cursor-1")
    // Newest-first ordering and server-side exclusion of text + key-sharing payloads.
    expect(body.query).toContain("CREATED_BLOCK_DESC")
    expect(body.query).toContain("text/plain;charset=utf-8")
    expect(body.query).toContain("application/didcomm-encrypted+json")
  })

  it("defaults to first=20 and omits after on the initial file page", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: { messages: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }
      })
    }))
    vi.stubGlobal("fetch", fetchMock)

    const page = await fetchFileMessagesPage("https://indexer.example/graphql", "3")

    expect(page).toEqual({ nodes: [], hasNextPage: false, endCursor: null })

    const body = getRequestBody(fetchMock) as { variables: Record<string, unknown> }
    expect(body.variables.first).toBe(20)
    expect("after" in body.variables).toBe(false)
  })

  it("isFileMessage keeps real files and rejects text and key-sharing messages", () => {
    expect(isFileMessage({ contentType: "image/png", tag: null })).toBe(true)
    expect(isFileMessage({ contentType: "application/pdf", tag: null })).toBe(true)
    expect(isFileMessage({ contentType: "text/plain;charset=utf-8", tag: null })).toBe(false)
    expect(isFileMessage({ contentType: "application/didcomm-encrypted+json", tag: null })).toBe(false)
    // Key-sharing carries a real content type but must never count as a file.
    expect(isFileMessage({ contentType: "image/png", tag: "didcomm/key-sharing-v1" })).toBe(false)
    expect(isFileMessage({ contentType: null, tag: null })).toBe(false)
  })
})