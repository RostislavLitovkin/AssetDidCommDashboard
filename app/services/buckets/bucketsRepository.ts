import { BucketsGraphqlClient } from "./bucketsApiClient"
import { KEY_SHARING_CONTENT_TYPE, TEXT_CONTENT_TYPE } from "./valueCodecs"
import type {
  ApiBucket,
  ApiBucketWithMembers,
  ApiMessage,
  ApiNamespace,
  BucketDetail,
  BucketsRepositoryOptions,
  MessagePage,
  OperationUpdateHandler
} from "./types"

interface ConnectionPage<T> {
  nodes: T[]
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
}

const NAMESPACE_FIELDS = "id namespaceId name schemaUri properties creator createdAt"
const BUCKET_FIELDS =
  "id bucketId namespaceId creator name category isWritable encryptionKey createdAt updatedAt"
const MESSAGE_FIELDS =
  "id messageId contributor reference tag description contentType contentHash ipfsContent createdAt"

export class BucketsRepository {
  protected readonly client: BucketsGraphqlClient
  protected readonly options: BucketsRepositoryOptions

  constructor(options: BucketsRepositoryOptions) {
    this.options = options
    this.client = new BucketsGraphqlClient(options.apiUrl, options.fetcher)
  }

  /** Loop a cursor connection to exhaustion. `field` is the root field name. */
  protected async fetchAllPages<T>(
    field: string,
    document: string,
    variables: Record<string, unknown>
  ): Promise<T[]> {
    const all: T[] = []
    let after: string | null = null

    for (;;) {
      const vars: Record<string, unknown> = { ...variables }
      if (after) vars.after = after
      const data = await this.client.query<Record<string, ConnectionPage<T>>>(document, vars)
      const page = data[field]
      if (!page) throw new Error(`Buckets API response missing '${field}'`)
      all.push(...page.nodes)
      if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) return all
      after = page.pageInfo.endCursor
    }
  }

  /** Filter values use the Long scalar — numbers on the wire. */
  protected asLong(id: string, label: string): number {
    const value = Number(id.trim())
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must be numeric`)
    }
    return value
  }

  async fetchNamespaces(): Promise<ApiNamespace[]> {
    return this.fetchAllPages<ApiNamespace>(
      "namespaces",
      `query Namespaces($after: String) {
        namespaces(first: 50, after: $after, order: [{ createdAt: ASC }]) {
          nodes { ${NAMESPACE_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      {}
    )
  }

  async fetchNamespaceById(namespaceId: string): Promise<ApiNamespace | null> {
    const data = await this.client.query<{ namespace: ApiNamespace | null }>(
      `query NamespaceById($id: ID!) {
        namespace(id: $id) { ${NAMESPACE_FIELDS} }
      }`,
      { id: namespaceId.trim() }
    )
    return data.namespace
  }

  async fetchNamespacesByCreator(address: string): Promise<ApiNamespace[]> {
    return this.fetchAllPages<ApiNamespace>(
      "namespaces",
      `query NamespacesByCreator($address: String!, $after: String) {
        namespaces(first: 50, after: $after, where: { creator: { eq: $address } }, order: [{ createdAt: ASC }]) {
          nodes { ${NAMESPACE_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { address: address.trim() }
    )
  }

  async fetchNamespaceManagers(namespaceId: string): Promise<string[]> {
    const nodes = await this.fetchAllPages<{ manager: string }>(
      "namespaceManagers",
      `query NamespaceManagers($namespaceId: Long!, $after: String) {
        namespaceManagers(first: 50, after: $after, where: { namespaceId: { eq: $namespaceId } }, order: [{ addedAt: ASC }]) {
          nodes { manager }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { namespaceId: this.asLong(namespaceId, "Namespace id") }
    )
    return nodes.map((n) => n.manager)
  }

  async fetchBucketsByNamespace(namespaceId: string): Promise<ApiBucketWithMembers[]> {
    type Node = ApiBucket & { admins: Array<{ subjectId: string }>; contributors: Array<{ subjectId: string }> }
    const nodes = await this.fetchAllPages<Node>(
      "buckets",
      `query BucketsByNamespace($namespaceId: Long!, $after: String) {
        buckets(first: 50, after: $after, where: { namespaceId: { eq: $namespaceId } }, order: [{ createdAt: ASC }]) {
          nodes { ${BUCKET_FIELDS} admins { subjectId } contributors { subjectId } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { namespaceId: this.asLong(namespaceId, "Namespace id") }
    )
    return nodes.map((n) => ({
      ...n,
      admins: n.admins.map((a) => a.subjectId),
      contributors: n.contributors.map((c) => c.subjectId)
    }))
  }

  async fetchBucket(bucketId: string): Promise<ApiBucket | null> {
    const data = await this.client.query<{ buckets: { nodes: ApiBucket[] } }>(
      `query BucketByBucketId($bucketId: Long!) {
        buckets(first: 1, where: { bucketId: { eq: $bucketId } }) {
          nodes { ${BUCKET_FIELDS} }
        }
      }`,
      { bucketId: this.asLong(bucketId, "Bucket id") }
    )
    return data.buckets.nodes[0] ?? null
  }

  async fetchBucketDetail(bucketId: string): Promise<BucketDetail | null> {
    type Raw = ApiBucket & {
      admins: Array<{ subjectId: string }>
      contributors: Array<{ subjectId: string }>
      viewers: Array<{ viewerId: string }>
      messages: Array<Omit<ApiMessage, "bucketId">>
    }
    const data = await this.client.query<{ bucket: Raw | null }>(
      `query BucketDetail($id: ID!) {
        bucket(id: $id) {
          ${BUCKET_FIELDS}
          admins { subjectId }
          contributors { subjectId }
          viewers { viewerId }
          messages { ${MESSAGE_FIELDS} }
        }
      }`,
      { id: bucketId.trim() }
    )
    if (!data.bucket) return null
    const { admins, contributors, viewers, messages, ...bucket } = data.bucket
    return {
      bucket,
      admins: admins.map((a) => a.subjectId),
      contributors: contributors.map((c) => c.subjectId),
      viewers: viewers.map((v) => v.viewerId),
      messages: messages.map((m) => ({ ...m, bucketId: bucket.bucketId }))
    }
  }

  private async fetchMemberList(
    field: "bucketAdmins" | "bucketContributors" | "bucketViewers",
    idField: "subjectId" | "viewerId",
    bucketId: string
  ): Promise<string[]> {
    const nodes = await this.fetchAllPages<Record<string, string>>(
      field,
      `query Members($bucketId: Long!, $after: String) {
        ${field}(first: 50, after: $after, where: { bucketId: { eq: $bucketId } }, order: [{ addedAt: ASC }]) {
          nodes { ${idField} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { bucketId: this.asLong(bucketId, "Bucket id") }
    )
    return nodes.map((n) => n[idField]!)
  }

  async fetchBucketAdmins(bucketId: string): Promise<string[]> {
    return this.fetchMemberList("bucketAdmins", "subjectId", bucketId)
  }

  async fetchBucketContributors(bucketId: string): Promise<string[]> {
    return this.fetchMemberList("bucketContributors", "subjectId", bucketId)
  }

  async fetchBucketViewers(bucketId: string): Promise<string[]> {
    return this.fetchMemberList("bucketViewers", "viewerId", bucketId)
  }

  private mapMessageNode(node: Omit<ApiMessage, "bucketId"> & { bucket: { bucketId: string } }): ApiMessage {
    const { bucket, ...rest } = node
    return { ...rest, bucketId: bucket.bucketId }
  }

  async fetchMessages(bucketId: string): Promise<ApiMessage[]> {
    type Node = Omit<ApiMessage, "bucketId"> & { bucket: { bucketId: string } }
    const nodes = await this.fetchAllPages<Node>(
      "messages",
      `query BucketMessages($bucketId: Long!, $after: String) {
        messages(first: 50, after: $after, where: { bucket: { bucketId: { eq: $bucketId } } }, order: [{ createdAt: ASC }]) {
          nodes { ${MESSAGE_FIELDS} bucket { bucketId } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { bucketId: this.asLong(bucketId, "Bucket id") }
    )
    return nodes.map((n) => this.mapMessageNode(n))
  }

  async fetchMessagesByTag(bucketId: string, tag: string): Promise<ApiMessage[]> {
    type Node = Omit<ApiMessage, "bucketId"> & { bucket: { bucketId: string } }
    const nodes = await this.fetchAllPages<Node>(
      "messages",
      `query BucketMessagesByTag($bucketId: Long!, $tag: String!, $after: String) {
        messages(first: 50, after: $after, where: { bucket: { bucketId: { eq: $bucketId } }, tag: { eq: $tag } }, order: [{ createdAt: ASC }]) {
          nodes { ${MESSAGE_FIELDS} bucket { bucketId } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { bucketId: this.asLong(bucketId, "Bucket id"), tag }
    )
    return nodes.map((n) => this.mapMessageNode(n))
  }

  async fetchFileMessagesPage(
    bucketId: string,
    opts?: { first?: number; after?: string | null }
  ): Promise<MessagePage> {
    type Node = Omit<ApiMessage, "bucketId"> & { bucket: { bucketId: string } }
    const vars: Record<string, unknown> = {
      bucketId: this.asLong(bucketId, "Bucket id"),
      first: opts?.first ?? 20
    }
    if (opts?.after) vars.after = opts.after

    const data = await this.client.query<{ messages: ConnectionPage<Node> }>(
      `query FileMessagesPage($bucketId: Long!, $first: Int!, $after: String) {
        messages(
          first: $first
          after: $after
          where: {
            bucket: { bucketId: { eq: $bucketId } }
            contentType: { neq: null, nin: ["${TEXT_CONTENT_TYPE}", "${KEY_SHARING_CONTENT_TYPE}"] }
          }
          order: [{ createdAt: DESC }]
        ) {
          nodes { ${MESSAGE_FIELDS} bucket { bucketId } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      vars
    )
    return {
      nodes: data.messages.nodes.map((n) => this.mapMessageNode(n)),
      hasNextPage: data.messages.pageInfo.hasNextPage,
      endCursor: data.messages.pageInfo.endCursor
    }
  }

  async fetchLatestMessageTimes(bucketIds: string[]): Promise<Record<string, string>> {
    const numeric = bucketIds.map((id) => this.asLong(id, "Bucket id"))
    if (!numeric.length) return {}

    const fields = numeric
      .map(
        (id, i) =>
          `b${i}: messages(first: 1, where: { bucket: { bucketId: { eq: ${id} } } }, order: [{ createdAt: DESC }]) { nodes { createdAt } }`
      )
      .join("\n")
    const data = await this.client.query<Record<string, { nodes: Array<{ createdAt: string }> }>>(
      `query LatestMessageTimes {\n${fields}\n}`
    )

    const result: Record<string, string> = {}
    numeric.forEach((id, i) => {
      const createdAt = data[`b${i}`]?.nodes[0]?.createdAt
      if (createdAt) result[String(id)] = createdAt
    })
    return result
  }
}
