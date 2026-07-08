/**
 * SubQuery GraphQL client for the xcavate indexer.
 *
 * Provides typed queries against the indexed bucket/message/member data
 * so the UI never needs to touch raw RPC storage reads.
 */

// -- Response shapes --

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

export interface IndexedNamespace {
  id: string
  namespaceId: number
  name: string | null
  schemaUri: string | null
  properties: string | null
  createdAt: number
  creator: string | null
}

export interface IndexedNamespaceManager {
  id: string
  namespaceId: string
  manager: string
  addedBlock: number
}

export interface IndexedBucketWithCounts {
  id: string
  namespaceId: number
  bucketId: number
  creator: string | null
  name: string | null
  category: string | null
  isWritable: boolean
  encryptionKey: string | null
  createdBlock: number
  adminCount: number
  contributorCount: number
}

type IndexedBucketWithRelations = Omit<IndexedBucketWithCounts, "adminCount" | "contributorCount"> & {
  admins?: { totalCount?: number }
  contributors?: { totalCount?: number }
}

function normalizeBucketCounts(bucket: IndexedBucketWithRelations): IndexedBucketWithCounts {
  return {
    ...bucket,
    adminCount: bucket.admins?.totalCount ?? 0,
    contributorCount: bucket.contributors?.totalCount ?? 0
  }
}

// -- GraphQL helper --

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

// -- Public queries --

const BUCKET_DETAIL_QUERY = `
query BucketDetail($id: String!) {
  bucket(id: $id) {
    id namespaceId bucketId creator name category isWritable encryptionKey createdBlock
    admins(orderBy: [ADDED_BLOCK_ASC]) {
      nodes { id bucketId subjectId addedBlock }
    }
    contributors(orderBy: [ADDED_BLOCK_ASC]) {
      nodes { id bucketId subjectId addedBlock }
    }
    messages(orderBy: [CREATED_BLOCK_ASC]) {
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
  messages(filter: { bucketId: { equalTo: $bucketId } }, orderBy: [CREATED_BLOCK_ASC], after: $after) {
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
    orderBy: [CREATED_BLOCK_ASC],
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

// -- Namespace queries --

const NAMESPACES_QUERY = `
query Namespaces($after: Cursor, $first: Int, $orderBy: [NamespacesOrderBy!]) {
  namespaces(orderBy: $orderBy, after: $after, first: $first) {
    nodes { id namespaceId name schemaUri properties createdAt creator }
    pageInfo { hasNextPage endCursor }
  }
}
`

export async function fetchIndexedNamespaces(
  endpoint: string,
  orderBy?: string | string[]
): Promise<IndexedNamespace[]> {
  const all: IndexedNamespace[] = []
  let after: string | null = null

  // eslint-disable-next-line no-constant-condition
  while (true) {
    interface Raw {
      namespaces: {
        nodes: IndexedNamespace[]
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }

    const vars: Record<string, unknown> = {}
    if (orderBy) vars.orderBy = Array.isArray(orderBy) ? orderBy : [orderBy]
    if (after) vars.after = after

    const data = await gql<Raw>(endpoint, NAMESPACES_QUERY, vars)
    all.push(...data.namespaces.nodes)

    if (!data.namespaces.pageInfo.hasNextPage) break
    after = data.namespaces.pageInfo.endCursor ?? null
    if (!after) break
  }

  return all
}

const NAMESPACE_BY_ID_QUERY = `
query NamespaceById($id: String!) {
  namespace(id: $id) {
    id namespaceId name schemaUri properties createdAt creator
  }
}
`

export async function fetchIndexedNamespaceById(
  endpoint: string,
  namespaceId: string
): Promise<IndexedNamespace | null> {
  interface Raw {
    namespace: IndexedNamespace | null
  }

  const data = await gql<Raw>(endpoint, NAMESPACE_BY_ID_QUERY, { id: namespaceId })
  return data.namespace
}

const NAMESPACE_MANAGERS_QUERY = `
query NamespaceManagers($namespaceId: String!, $after: Cursor, $first: Int) {
  namespaceManagers(filter: { namespaceId: { equalTo: $namespaceId } }, orderBy: [ADDED_BLOCK_ASC], after: $after, first: $first) {
    nodes { id namespaceId manager addedBlock }
    pageInfo { hasNextPage endCursor }
  }
}
`

export async function fetchIndexedNamespaceManagers(
  endpoint: string,
  namespaceId: string
): Promise<IndexedNamespaceManager[]> {
  const all: IndexedNamespaceManager[] = []
  let after: string | null = null

  // eslint-disable-next-line no-constant-condition
  while (true) {
    interface Raw {
      namespaceManagers: {
        nodes: IndexedNamespaceManager[]
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }

    const vars: Record<string, unknown> = { namespaceId }
    if (after) vars.after = after

    const data = await gql<Raw>(endpoint, NAMESPACE_MANAGERS_QUERY, vars)
    all.push(...data.namespaceManagers.nodes)

    if (!data.namespaceManagers.pageInfo.hasNextPage) break
    after = data.namespaceManagers.pageInfo.endCursor ?? null
    if (!after) break
  }

  return all
}

const BUCKETS_BY_NAMESPACE_QUERY = `
query BucketsByNamespace($namespaceId: BigFloat!, $after: Cursor, $first: Int) {
  buckets(filter: { namespaceId: { equalTo: $namespaceId } }, orderBy: [CREATED_BLOCK_ASC], after: $after, first: $first) {
    nodes {
      id namespaceId bucketId creator name category isWritable encryptionKey createdBlock
      admins { totalCount }
      contributors { totalCount }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`

export async function fetchIndexedBucketsByNamespace(
  endpoint: string,
  namespaceId: string
): Promise<IndexedBucketWithCounts[]> {
  const all: IndexedBucketWithCounts[] = []
  let after: string | null = null
  const numericNamespaceId = Number(namespaceId)
  if (!Number.isFinite(numericNamespaceId)) {
    throw new Error("Namespace id must be numeric for indexer bucket queries")
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    interface Raw {
      buckets: {
        nodes: IndexedBucketWithRelations[]
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }

    const vars: Record<string, unknown> = { namespaceId: numericNamespaceId }
    if (after) vars.after = after

    const data = await gql<Raw>(endpoint, BUCKETS_BY_NAMESPACE_QUERY, vars)
    all.push(...data.buckets.nodes.map(normalizeBucketCounts))

    if (!data.buckets.pageInfo.hasNextPage) break
    after = data.buckets.pageInfo.endCursor ?? null
    if (!after) break
  }

  return all
}

const BUCKETS_FILTERED_QUERY = `
query BucketsFiltered($filter: BucketFilter!, $after: Cursor, $first: Int) {
  buckets(filter: $filter, orderBy: [CREATED_BLOCK_ASC], after: $after, first: $first) {
    nodes {
      id namespaceId bucketId creator name category isWritable encryptionKey createdBlock
      admins { totalCount }
      contributors { totalCount }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`

export async function fetchIndexedBucketsFiltered(
  endpoint: string,
  filter: Record<string, unknown>
): Promise<IndexedBucketWithCounts[]> {
  const all: IndexedBucketWithCounts[] = []
  let after: string | null = null

  // eslint-disable-next-line no-constant-condition
  while (true) {
    interface Raw {
      buckets: {
        nodes: IndexedBucketWithRelations[]
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }

    const vars: Record<string, unknown> = { filter }
    if (after) vars.after = after

    const data = await gql<Raw>(endpoint, BUCKETS_FILTERED_QUERY, vars)
    all.push(...data.buckets.nodes.map(normalizeBucketCounts))

    if (!data.buckets.pageInfo.hasNextPage) break
    after = data.buckets.pageInfo.endCursor ?? null
    if (!after) break
  }

  return all
}

const NAMESPACES_BY_ADDRESS_QUERY = `
query NamespacesByAddress($address: String!, $after: Cursor, $first: Int) {
  namespaces(filter: { creator: { equalToInsensitive: $address } }, orderBy: [CREATED_AT_ASC], after: $after, first: $first) {
    nodes { id namespaceId name schemaUri properties createdAt creator }
    pageInfo { hasNextPage endCursor }
  }
}
`

export async function fetchIndexedNamespacesByAddress(
  endpoint: string,
  address: string
): Promise<IndexedNamespace[]> {
  const all: IndexedNamespace[] = []
  let after: string | null = null

  // eslint-disable-next-line no-constant-condition
  while (true) {
    interface Raw {
      namespaces: {
        nodes: IndexedNamespace[]
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }

    const vars: Record<string, unknown> = { address }
    if (after) vars.after = after

    const data = await gql<Raw>(endpoint, NAMESPACES_BY_ADDRESS_QUERY, vars)
    all.push(...data.namespaces.nodes)

    if (!data.namespaces.pageInfo.hasNextPage) break
    after = data.namespaces.pageInfo.endCursor ?? null
    if (!after) break
  }

  return all
}
