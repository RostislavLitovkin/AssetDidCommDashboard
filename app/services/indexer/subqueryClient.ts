/**
 * SubQuery GraphQL client for the xcavate indexer.
 *
 * Provides typed queries against the indexed bucket/message/member data
 * so the UI never needs to touch raw RPC storage reads.
 */

// ── Response shapes ────────────────────────────────────────────────

export interface IndexedBucket {
  id: string
  namespaceId: number
  bucketId: number
  creator: string | null
  name: string | null
  category: string | null
  isWritable: boolean
  encryptionKey: string | null
  createdBlock: number
}

export interface IndexedMessage {
  id: string
  bucketId: string
  messageId: number
  contributor: string
  reference: string | null
  tag: string | null
  description: string | null
  contentType: string | null
  contentHash: string | null
  createdBlock: number
  ipfsContent: string | null
}

export interface IndexedBucketMember {
  id: string
  bucketId: string
  subjectId: string
  addedBlock: number
}

export interface IndexedBucketDetail {
  bucket: IndexedBucket
  admins: IndexedBucketMember[]
  contributors: IndexedBucketMember[]
  messages: IndexedMessage[]
}

// ── GraphQL helper ─────────────────────────────────────────────────

async function gql<T>(endpoint: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  })

  if (!res.ok) {
    throw new Error(`SubQuery HTTP ${res.status}: ${res.statusText}`)
  }

  const json = (await res.json()) as { data?: T; errors?: { message: string }[] }

  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "))
  }

  if (!json.data) {
    throw new Error("SubQuery returned no data")
  }

  return json.data
}

// ── Public queries ─────────────────────────────────────────────────

const BUCKET_DETAIL_QUERY = `
query BucketDetail($id: String!) {
  bucket(id: $id) {
    id namespaceId bucketId creator name category isWritable encryptionKey createdBlock
    admins(orderBy: ADDED_BLOCK_ASC) {
      nodes { id bucketId subjectId addedBlock }
    }
    contributors(orderBy: ADDED_BLOCK_ASC) {
      nodes { id bucketId subjectId addedBlock }
    }
    messages(orderBy: CREATED_BLOCK_ASC) {
      nodes { id bucketId messageId contributor reference tag description contentType contentHash createdBlock ipfsContent }
    }
  }
}
`

export async function fetchIndexedBucketDetail(
  endpoint: string,
  bucketId: string
): Promise<IndexedBucketDetail | null> {
  interface Raw {
    bucket: (IndexedBucket & {
      admins: { nodes: IndexedBucketMember[] }
      contributors: { nodes: IndexedBucketMember[] }
      messages: { nodes: IndexedMessage[] }
    }) | null
  }

  const data = await gql<Raw>(endpoint, BUCKET_DETAIL_QUERY, { id: bucketId })

  if (!data.bucket) {
    return null
  }

  return {
    bucket: data.bucket,
    admins: data.bucket.admins.nodes,
    contributors: data.bucket.contributors.nodes,
    messages: data.bucket.messages.nodes,
  }
}

const MESSAGES_QUERY = `
query BucketMessages($bucketId: String!, $after: Cursor) {
  messages(filter: { bucketId: { equalTo: $bucketId } }, orderBy: CREATED_BLOCK_ASC, after: $after) {
    nodes { id bucketId messageId contributor reference tag description contentType contentHash createdBlock ipfsContent }
    pageInfo { hasNextPage endCursor }
  }
}
`

export async function fetchIndexedMessages(
  endpoint: string,
  bucketId: string
): Promise<IndexedMessage[]> {
  const all: IndexedMessage[] = []
  let after: string | null = null

  // eslint-disable-next-line no-constant-condition
  while (true) {
    interface Raw {
      messages: {
        nodes: IndexedMessage[]
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }

    const vars: Record<string, unknown> = { bucketId }
    if (after) vars.after = after

    const data = await gql<Raw>(endpoint, MESSAGES_QUERY, vars)
    all.push(...data.messages.nodes)

    if (!data.messages.pageInfo.hasNextPage) break
    after = data.messages.pageInfo.endCursor ?? null
    if (!after) break
  }

  return all
}

const MESSAGES_BY_TAG_QUERY = `
query BucketMessagesByTag($bucketId: String!, $tag: String!, $after: Cursor) {
  messages(
    filter: { bucketId: { equalTo: $bucketId }, tag: { equalTo: $tag } },
    orderBy: CREATED_BLOCK_ASC,
    after: $after
  ) {
    nodes { id bucketId messageId contributor reference tag description contentType contentHash createdBlock ipfsContent }
    pageInfo { hasNextPage endCursor }
  }
}
`

export async function fetchIndexedMessagesByTag(
  endpoint: string,
  bucketId: string,
  tag: string
): Promise<IndexedMessage[]> {
  const all: IndexedMessage[] = []
  let after: string | null = null

  // eslint-disable-next-line no-constant-condition
  while (true) {
    interface Raw {
      messages: {
        nodes: IndexedMessage[]
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }

    const vars: Record<string, unknown> = { bucketId, tag }
    if (after) vars.after = after

    const data = await gql<Raw>(endpoint, MESSAGES_BY_TAG_QUERY, vars)
    all.push(...data.messages.nodes)

    if (!data.messages.pageInfo.hasNextPage) break
    after = data.messages.pageInfo.endCursor ?? null
    if (!after) break
  }

  return all
}
