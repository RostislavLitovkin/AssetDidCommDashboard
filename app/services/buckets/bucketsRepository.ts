import { BucketsGraphqlClient } from "./bucketsApiClient"
import { KEY_SHARING_CONTENT_TYPE, KEY_SHARING_MESSAGE_TAG, TEXT_CONTENT_TYPE, normalizeFixed32ByteKey, sha256HexUtf8 } from "./valueCodecs"
import { PinataStorageAdapter } from "../storage/pinataStorageAdapter"
import type {
  ApiBucket,
  ApiBucketWithMembers,
  ApiMessage,
  ApiNamespace,
  BucketDetail,
  BucketMemberRole,
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

/**
 * The API caps `MessageInput.ipfsContent` at 1 MiB of characters and rejects
 * the whole write above it. A file message carries the entire encrypted file
 * as its content, so anything past ~750 KB of file blows the cap.
 */
const MAX_IPFS_CONTENT_CHARS = 1_048_576

export class BucketsRepository {
  protected readonly client: BucketsGraphqlClient
  protected readonly options: BucketsRepositoryOptions
  private namespaceIdByBucket = new Map<string, string | null>()

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
      id: string; bucketId: string; namespaceId: string | null; name: string | null; creator: string | null
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
              { and: [{ creator: { eq: $address } }, { namespaceId: { eq: null } }] }
            ]
          }
        ) {
          totalCount
          nodes {
            id bucketId namespaceId name creator
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
        isViewer: Boolean(viewerKeyHex) && n.viewers.some((v) => v.viewerId === viewerKeyHex),
        isCreator: n.creator === address
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

  /** Run one signed mutation with signing/submitting/success/error updates. */
  private async runMutation<T>(
    method: string,
    ownerAddress: string,
    onUpdate: OperationUpdateHandler | undefined,
    document: string,
    variables: Record<string, unknown>,
    extractId: (data: T) => string
  ): Promise<MutationResult> {
    const sign = this.requireSign(ownerAddress)
    // The signature is a wallet popup and the request is a network round trip.
    // They are separate waits, so the UI gets separate stages: the boundary is
    // the moment `sign` resolves.
    onUpdate?.({ stage: "signing", message: "Waiting for your signature…" })
    const signWithProgress = async (rawBody: string): Promise<HeadersInit> => {
      const headers = await sign(rawBody)
      onUpdate?.({ stage: "submitting", message: "Submitting…" })
      return headers
    }
    try {
      const data = await this.client.mutate<T>(document, variables, signWithProgress)
      const id = extractId(data)
      onUpdate?.({ stage: "success", message: "Submitted" })
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

  /** A null `namespaceId` creates a standalone bucket — any signed caller may. */
  async createBucket(
    namespaceId: string | null,
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
      `mutation CreateBucket($namespaceId: BigInt, $metadata: BucketMetadataInput!) {
        createBucket(namespaceId: $namespaceId, metadata: $metadata) { id bucketId }
      }`,
      {
        namespaceId: namespaceId?.trim() || null,
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
    namespaceId: string | null,
    bucketId: string,
    member: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    return this.runMutation<Record<string, boolean>>(
      field,
      ownerAddress,
      onUpdate,
      `mutation RemoveMember($namespaceId: BigInt, $bucketId: BigInt!, $${argName}: String!) {
        ${field}(namespaceId: $namespaceId, bucketId: $bucketId, ${argName}: $${argName})
      }`,
      { namespaceId: namespaceId?.trim() || null, bucketId: bucketId.trim(), [argName]: member.trim() },
      (d) => {
        if (d[field] !== true) {
          throw new Error(`${field} reported no change — the member may not have had that role`)
        }
        return member.trim()
      }
    )
  }

  async removeBucketAdmin(namespaceId: string | null, bucketId: string, memberAddress: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult> {
    return this.removeMember("removeAdmin", "admin", namespaceId, bucketId, memberAddress, ownerAddress, onUpdate)
  }

  async removeBucketContributor(namespaceId: string | null, bucketId: string, memberAddress: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult> {
    return this.removeMember("removeContributor", "contributor", namespaceId, bucketId, memberAddress, ownerAddress, onUpdate)
  }

  async removeBucketViewer(namespaceId: string | null, bucketId: string, viewerKey: string, ownerAddress: string, onUpdate?: OperationUpdateHandler): Promise<MutationResult> {
    return this.removeMember("removeViewer", "viewer", namespaceId, bucketId, normalizeFixed32ByteKey(viewerKey), ownerAddress, onUpdate)
  }

  async setBucketPublicKey(
    namespaceId: string | null,
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
      `mutation ResumeWriting($namespaceId: BigInt, $bucketId: BigInt!, $newEncryptionKey: String!) {
        resumeWriting(namespaceId: $namespaceId, bucketId: $bucketId, newEncryptionKey: $newEncryptionKey) { id }
      }`,
      { namespaceId: namespaceId?.trim() || null, bucketId: bucketId.trim(), newEncryptionKey: key },
      (d) => d.resumeWriting.id
    )
  }

  /**
   * Resolve (and cache) the namespace that owns `bucketId` — `write` needs both
   * ids. Standalone buckets resolve to null, which the API accepts as-is.
   */
  private async resolveNamespaceId(bucketId: string): Promise<string | null> {
    if (this.namespaceIdByBucket.has(bucketId)) return this.namespaceIdByBucket.get(bucketId)!
    const bucket = await this.fetchBucket(bucketId)
    if (!bucket) throw new Error(`Bucket ${bucketId} was not found`)
    this.namespaceIdByBucket.set(bucketId, bucket.namespaceId)
    return bucket.namespaceId
  }

  private async buildMessageInput(
    content: string,
    tag: string | undefined,
    contentTypeOverride: string | undefined
  ): Promise<Record<string, unknown>> {
    const normalizedTag = tag?.trim() || undefined
    const contentType =
      contentTypeOverride?.trim() ||
      (normalizedTag === KEY_SHARING_MESSAGE_TAG ? KEY_SHARING_CONTENT_TYPE : TEXT_CONTENT_TYPE)

    const pinata = new PinataStorageAdapter(this.options.pinataConfig)
    const cid = await pinata.upload(content)

    // `ipfsContent` only mirrors the payload so readers can skip the gateway
    // round-trip; the payload itself lives on IPFS under `reference`. When it
    // is too large for the API, drop the mirror rather than fail the write —
    // every read path already falls back to fetching from `reference`.
    return {
      reference: cid,
      tag: normalizedTag ?? null,
      ipfsContent: content.length <= MAX_IPFS_CONTENT_CHARS ? content : null,
      metadata: {
        description: "",
        contentType,
        contentHash: await sha256HexUtf8(content),
        properties: []
      }
    }
  }

  async createMessage(
    bucketId: string,
    message: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler,
    tag?: string,
    contentType?: string
  ): Promise<MutationResult> {
    const trimmedBucketId = bucketId.trim()
    const trimmedMessage = message.trim()
    if (!trimmedBucketId) throw new Error("Bucket id is required")
    if (!trimmedMessage) throw new Error("Message is required")

    const namespaceId = await this.resolveNamespaceId(trimmedBucketId)
    const messageInput = await this.buildMessageInput(trimmedMessage, tag, contentType)

    return this.runMutation<{ write: { id: string } }>(
      "write",
      ownerAddress,
      onUpdate,
      `mutation WriteMessage($namespaceId: BigInt, $bucketId: BigInt!, $message: MessageInput!) {
        write(namespaceId: $namespaceId, bucketId: $bucketId, message: $message) { id messageId }
      }`,
      { namespaceId, bucketId: trimmedBucketId, message: messageInput },
      (d) => d.write.id
    )
  }

  async createFileMessage(
    bucketId: string,
    fileJwe: string,
    fileContentType: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    const trimmedJwe = fileJwe.trim()
    if (!trimmedJwe) throw new Error("File payload is required")
    const contentType = fileContentType.trim() || "application/octet-stream"
    return this.createMessage(bucketId, trimmedJwe, ownerAddress, onUpdate, undefined, contentType)
  }

  async rotateBucketKeyAndShare(
    namespaceId: string | null,
    bucketId: string,
    newEncryptionKey: string,
    tag: string,
    message: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    const key = normalizeFixed32ByteKey(newEncryptionKey.trim())
    const messageInput = await this.buildMessageInput(message.trim(), tag, undefined)

    // resumeWriting, not rotateKey: a freshly created bucket is Locked and
    // rotateKey refuses locked buckets, so the first key must be set with
    // resumeWriting. It behaves identically on an already-writable bucket
    // (sets the key, keeps it writable), so it covers key regeneration too.
    // createTag precedes write because the API rejects messages whose tag was
    // never created; it is idempotent, so repeating it on every rotation is safe.
    return this.runMutation<{ resumeWriting?: { id: string }; createTag?: { id: string }; write: { id: string } }>(
      "resumeWriting+createTag+write",
      ownerAddress,
      onUpdate,
      `mutation RotateKeyAndShare($namespaceId: BigInt, $bucketId: BigInt!, $newEncryptionKey: String!, $newTag: String!, $message: MessageInput!) {
        resumeWriting(namespaceId: $namespaceId, bucketId: $bucketId, newEncryptionKey: $newEncryptionKey) { id }
        createTag(bucketId: $bucketId, newTag: $newTag) { id }
        write(namespaceId: $namespaceId, bucketId: $bucketId, message: $message) { id messageId }
      }`,
      {
        namespaceId: namespaceId?.trim() || null,
        bucketId: bucketId.trim(),
        newEncryptionKey: key,
        newTag: tag.trim(),
        message: messageInput
      },
      (d) => {
        if (!d.resumeWriting?.id) {
          throw new Error("resumeWriting reported no result — the key may not have been set")
        }
        if (!d.createTag?.id) {
          throw new Error("createTag reported no result — the key-sharing tag may not exist")
        }
        return d.write.id
      }
    )
  }

  async addBucketMemberWithRole(
    role: BucketMemberRole,
    namespaceId: string | null,
    bucketId: string,
    ss58Address: string,
    x25519Key: string,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    const viewerKey = normalizeFixed32ByteKey(x25519Key.trim())
    const vars: Record<string, unknown> = {
      namespaceId: namespaceId?.trim() || null,
      bucketId: bucketId.trim(),
      viewerKey
    }

    if (role === "viewer") {
      return this.runMutation<{ addViewer: { id: string } }>(
        "addViewer",
        ownerAddress,
        onUpdate,
        `mutation AddViewer($namespaceId: BigInt, $bucketId: BigInt!, $viewerKey: String!) {
          addViewer(namespaceId: $namespaceId, bucketId: $bucketId, viewer: $viewerKey) { id }
        }`,
        vars,
        (d) => d.addViewer.id
      )
    }

    vars.subject = ss58Address.trim()

    // "admin" also grants the contributor role: the API's write check — a
    // faithful pallet port — accepts only contributors, and the dashboard
    // expects admins to write messages, key sharing included. Field order
    // matters: addAdmin runs first so a manager adding themselves passes the
    // admin-caller check that addContributor and addViewer make.
    const roleFields: Array<[field: string, arg: string]> =
      role === "admin"
        ? [["addAdmin", "admin"], ["addContributor", "contributor"]]
        : [["addContributor", "contributor"]]
    const fieldNames = [...roleFields.map(([field]) => field), "addViewer"]
    const fieldLines = [
      ...roleFields.map(
        ([field, arg]) => `${field}(namespaceId: $namespaceId, bucketId: $bucketId, ${arg}: $subject) { id }`
      ),
      "addViewer(namespaceId: $namespaceId, bucketId: $bucketId, viewer: $viewerKey) { id }"
    ]

    return this.runMutation<Record<string, { id: string } | undefined>>(
      fieldNames.join("+"),
      ownerAddress,
      onUpdate,
      `mutation AddMemberWithViewer($namespaceId: BigInt, $bucketId: BigInt!, $subject: String!, $viewerKey: String!) {
        ${fieldLines.join("\n        ")}
      }`,
      vars,
      (d) => {
        for (const field of fieldNames) {
          if (!d[field]?.id) {
            throw new Error(`${field} reported no result — the member may not have been fully added`)
          }
        }
        return d[fieldNames[0]!]!.id
      }
    )
  }

  async removeBucketMemberRoles(
    namespaceId: string | null,
    bucketId: string,
    memberAddress: string,
    roles: BucketMemberRole[],
    viewerKey: string | undefined,
    ownerAddress: string,
    onUpdate?: OperationUpdateHandler
  ): Promise<MutationResult> {
    const orderedRoles: BucketMemberRole[] = (["admin", "contributor", "viewer"] as const).filter(
      (role) => roles.includes(role)
    )
    if (!orderedRoles.length) throw new Error("At least one role is required to remove a member")
    if (orderedRoles.includes("viewer") && !viewerKey?.trim()) {
      throw new Error("Viewer key is required to remove a viewer")
    }

    const fields: string[] = []
    const fieldNames: string[] = []
    const varDefs: string[] = ["$namespaceId: BigInt", "$bucketId: BigInt!"]
    const vars: Record<string, unknown> = {
      namespaceId: namespaceId?.trim() || null,
      bucketId: bucketId.trim()
    }
    if (orderedRoles.includes("admin") || orderedRoles.includes("contributor")) {
      varDefs.push("$subject: String!")
      vars.subject = memberAddress.trim()
    }
    if (orderedRoles.includes("admin")) {
      fieldNames.push("removeAdmin")
      fields.push("removeAdmin(namespaceId: $namespaceId, bucketId: $bucketId, admin: $subject)")
    }
    if (orderedRoles.includes("contributor")) {
      fieldNames.push("removeContributor")
      fields.push("removeContributor(namespaceId: $namespaceId, bucketId: $bucketId, contributor: $subject)")
    }
    if (orderedRoles.includes("viewer")) {
      varDefs.push("$viewerKey: String!")
      vars.viewerKey = normalizeFixed32ByteKey(viewerKey!.trim())
      fieldNames.push("removeViewer")
      fields.push("removeViewer(namespaceId: $namespaceId, bucketId: $bucketId, viewer: $viewerKey)")
    }

    return this.runMutation<Record<string, boolean>>(
      orderedRoles.map((r) => `remove-${r}`).join("+"),
      ownerAddress,
      onUpdate,
      `mutation RemoveMemberRoles(${varDefs.join(", ")}) {\n${fields.join("\n")}\n}`,
      vars,
      (d) => {
        for (const field of fieldNames) {
          if (d[field] !== true) {
            throw new Error(`${field} reported no change — the member may not have had that role`)
          }
        }
        return memberAddress.trim()
      }
    )
  }
}
