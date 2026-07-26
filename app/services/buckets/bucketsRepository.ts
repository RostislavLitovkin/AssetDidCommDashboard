import { BucketsGraphqlClient } from "./bucketsApiClient"
import { KEY_SHARING_CONTENT_TYPE, TEXT_CONTENT_TYPE, normalizeFixed32ByteKey } from "./valueCodecs"
import type {
  ApiBucket,
  ApiBucketWithMembers,
  ApiMessage,
  ApiNamespace,
  BucketDetail,
  BucketsRepositoryOptions,
  MessagePage,
  MyBucketSummary,
  MutationResult,
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

  async fetchMyBuckets(
    address: string,
    viewerKeyHex: string,
    opts?: { first?: number; after?: string | null }
  ): Promise<{ nodes: MyBucketSummary[]; totalCount: number; hasNextPage: boolean; endCursor: string | null }> {
    type Node = {
      id: string; bucketId: string; namespaceId: string; name: string | null
      admins: Array<{ subjectId: string }>
      contributors: Array<{ subjectId: string }>
      viewers: Array<{ viewerId: string }>
    }
    const vars: Record<string, unknown> = {
      address,
      viewerKey: viewerKeyHex || " none",
      first: opts?.first ?? 20
    }
    if (opts?.after) vars.after = opts.after

    const data = await this.client.query<{ buckets: ConnectionPage<Node> & { totalCount: number } }>(
      `query MyBuckets($address: String!, $viewerKey: String!, $first: Int!, $after: String) {
        buckets(
          first: $first
          after: $after
          order: [{ updatedAt: DESC }, { bucketId: ASC }]
          where: {
            or: [
              { admins: { some: { subjectId: { eq: $address } } } }
              { contributors: { some: { subjectId: { eq: $address } } } }
              { viewers: { some: { viewerId: { eq: $viewerKey } } } }
            ]
          }
        ) {
          totalCount
          nodes {
            id bucketId namespaceId name
            admins { subjectId }
            contributors { subjectId }
            viewers { viewerId }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      vars
    )

    return {
      totalCount: data.buckets.totalCount,
      hasNextPage: data.buckets.pageInfo.hasNextPage,
      endCursor: data.buckets.pageInfo.endCursor,
      nodes: data.buckets.nodes.map((n) => ({
        id: n.id,
        bucketId: n.bucketId,
        namespaceId: n.namespaceId,
        name: n.name,
        isAdmin: n.admins.some((a) => a.subjectId === address),
        isContributor: n.contributors.some((c) => c.subjectId === address),
        isViewer: Boolean(viewerKeyHex) && n.viewers.some((v) => v.viewerId === viewerKeyHex)
      }))
    }
  }

  private requireSign(ownerAddress: string): (rawBody: string) => Promise<HeadersInit> {
    const sign = this.options.sign
    if (!sign) throw new Error("Repository was constructed without a signer")
    const address = ownerAddress.trim()
    if (!address) throw new Error("Wallet must be connected to submit this operation")
    return (rawBody) => sign(address, rawBody)
  }

  /** Run one signed mutation with pending/success/error updates. */
  private async runMutation<T>(
    method: string,
    ownerAddress: string,
    onUpdate: OperationUpdateHandler | undefined,
    document: string,
    variables: Record<string, unknown>,
    extractId: (data: T) => string
  ): Promise<MutationResult> {
    const sign = this.requireSign(ownerAddress)
    onUpdate?.({ stage: "pending", message: `Submitting ${method}…` })
    try {
      const data = await this.client.mutate<T>(document, variables, sign)
      const id = extractId(data)
      onUpdate?.({ stage: "success", message: `${method} confirmed` })
      return { id, method }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${method} failed`
      onUpdate?.({ stage: "error", message })
      throw error
    }
  }

  async createNamespace(
    name: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error("Namespace name is required")
    return this.runMutation<{ createNamespace: { id: string } }>(
      "createNamespace",
      ownerAddress,
      onUpdate,
      `mutation CreateNamespace($metadata: NamespaceMetadataInput!) {
        createNamespace(metadata: $metadata) { id namespaceId }
      }`,
      { metadata: { name: trimmed, schemaUri: null, properties: [] } },
      (d) => d.createNamespace.id
    )
  }

  async createBucket(
    namespaceId: string,
    name: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler,
    category?: string
  ): Promise<MutationResult> {
    const trimmedName = name.trim()
    if (!trimmedName) throw new Error("Bucket name is required")
    return this.runMutation<{ createBucket: { id: string } }>(
      "createBucket",
      ownerAddress,
      onUpdate,
      `mutation CreateBucket($namespaceId: BigInt!, $metadata: BucketMetadataInput!) {
        createBucket(namespaceId: $namespaceId, metadata: $metadata) { id bucketId }
      }`,
      {
        namespaceId: namespaceId.trim(),
        metadata: { name: trimmedName, category: category?.trim() ?? "", properties: [] }
      },
      (d) => d.createBucket.id
    )
  }

  async createTag(
    bucketId: string,
    tag: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    const trimmedTag = tag.trim()
    if (!trimmedTag) throw new Error("Tag is required")
    return this.runMutation<{ createTag: { id: string } }>(
      "createTag",
      ownerAddress,
      onUpdate,
      `mutation CreateTag($bucketId: BigInt!, $newTag: String!) {
        createTag(bucketId: $bucketId, newTag: $newTag) { id }
      }`,
      { bucketId: bucketId.trim(), newTag: trimmedTag },
      (d) => d.createTag.id
    )
  }

  async addNamespaceManager(
    namespaceId: string,
    memberAddress: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    return this.runMutation<{ addManager: { id: string } }>(
      "addManager",
      ownerAddress,
      onUpdate,
      `mutation AddManager($namespaceId: BigInt!, $newManager: String!) {
        addManager(namespaceId: $namespaceId, newManager: $newManager) { id }
      }`,
      { namespaceId: namespaceId.trim(), newManager: memberAddress.trim() },
      (d) => d.addManager.id
    )
  }

  async removeNamespaceManager(
    namespaceId: string,
    memberAddress: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    return this.runMutation<{ removeManager: boolean }>(
      "removeManager",
      ownerAddress,
      onUpdate,
      `mutation RemoveManager($namespaceId: BigInt!, $oldManager: String!) {
        removeManager(namespaceId: $namespaceId, oldManager: $oldManager)
      }`,
      { namespaceId: namespaceId.trim(), oldManager: memberAddress.trim() },
      (d) => {
        if (d.removeManager !== true) {
          throw new Error("removeManager reported no change — the address may not be a manager")
        }
        return memberAddress.trim()
      }
    )
  }

  private async removeMember(
    field: "removeAdmin" | "removeContributor" | "removeViewer",
    argName: "admin" | "contributor" | "viewer",
    namespaceId: string,
    bucketId: string,
    member: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    return this.runMutation<Record<string, boolean>>(
      field,
      ownerAddress,
      onUpdate,
      `mutation RemoveMember($namespaceId: BigInt!, $bucketId: BigInt!, $${argName}: String!) {
        ${field}(namespaceId: $namespaceId, bucketId: $bucketId, ${argName}: $${argName})
      }`,
      { namespaceId: namespaceId.trim(), bucketId: bucketId.trim(), [argName]: member.trim() },
      (d) => {
        if (d[field] !== true) {
          throw new Error(`${field} reported no change — the member may not have had that role`)
        }
        return member.trim()
      }
    )
  }

  async removeBucketAdmin(namespaceId: string, bucketId: string, memberAddress: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult> {
    return this.removeMember("removeAdmin", "admin", namespaceId, bucketId, memberAddress, ownerAddress, onUpdate)
  }

  async removeBucketContributor(namespaceId: string, bucketId: string, memberAddress: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult> {
    return this.removeMember("removeContributor", "contributor", namespaceId, bucketId, memberAddress, ownerAddress, onUpdate)
  }

  async removeBucketViewer(namespaceId: string, bucketId: string, viewerKey: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult> {
    return this.removeMember("removeViewer", "viewer", namespaceId, bucketId, normalizeFixed32ByteKey(viewerKey), ownerAddress, onUpdate)
  }

  async setBucketPublicKey(
    namespaceId: string,
    bucketId: string,
    newEncryptionKey: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    const key = normalizeFixed32ByteKey(newEncryptionKey.trim())
    return this.runMutation<{ resumeWriting: { id: string } }>(
      "resumeWriting",
      ownerAddress,
      onUpdate,
      `mutation ResumeWriting($namespaceId: BigInt!, $bucketId: BigInt!, $newEncryptionKey: String!) {
        resumeWriting(namespaceId: $namespaceId, bucketId: $bucketId, newEncryptionKey: $newEncryptionKey) { id }
      }`,
      { namespaceId: namespaceId.trim(), bucketId: bucketId.trim(), newEncryptionKey: key },
      (d) => d.resumeWriting.id
    )
  }
}
