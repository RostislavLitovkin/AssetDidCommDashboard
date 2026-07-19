import { PapiClient } from "./client"
import { PinataStorageAdapter } from "../storage/pinataStorageAdapter"
import {
  fetchIndexedNamespaces,
  fetchIndexedNamespaceById,
  fetchIndexedNamespaceManagers,
  fetchIndexedBucketsByNamespace,
  fetchIndexedBucketsFiltered,
  fetchIndexedMessages,
  fetchIndexedBucketDetail,
  fetchIndexedNamespacesByAddress,
  type IndexedNamespace,
  type IndexedBucketWithCounts,
  type IndexedMessage,
  type IndexedNamespaceManager,
  type IndexedBucketMember
} from "../indexer/subqueryClient"

type PapiRpcClient = {
  rpc(method: string, params?: unknown[]): Promise<unknown>
  getEndpoint?(): string
}

export type ExtrinsicUpdateStage = "submitted" | "broadcast" | "inBlock" | "finalized" | "error"

export interface ExtrinsicUpdate {
  stage: ExtrinsicUpdateStage
  message: string
  txHash?: string
  blockHash?: string
}

type ExtrinsicUpdateHandler = (update: ExtrinsicUpdate) => void

type ExtrinsicSubmitter = (
  endpoint: string,
  namespaceName: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
) => Promise<string>

type BucketExtrinsicSubmitter = (
  endpoint: string,
  namespaceId: string,
  bucketName: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler,
  category?: string
) => Promise<string>

type MessageExtrinsicSubmitter = (
  endpoint: string,
  bucketId: string,
  message: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler,
  tag?: string,
  pinataConfig?: PinataConfig,
  contentType?: string
) => Promise<string>

export interface PinataConfig {
  jwt?: string
  apiKey?: string
  apiSecret?: string
  publicGateway?: string
}

type BucketMemberExtrinsicSubmitter = (
  endpoint: string,
  namespaceId: string,
  bucketId: string,
  memberAddress: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
) => Promise<string>

type BucketPublicKeyExtrinsicSubmitter = (
  endpoint: string,
  namespaceId: string,
  bucketId: string,
  newEncryptionKey: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
) => Promise<string>

type BucketTagExtrinsicSubmitter = (
  endpoint: string,
  bucketId: string,
  tag: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
) => Promise<string>

type BucketKeyRotationBatchExtrinsicSubmitter = (
  endpoint: string,
  namespaceId: string,
  bucketId: string,
  newEncryptionKey: string,
  tag: string,
  message: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler,
  pinataConfig?: PinataConfig
) => Promise<string>

export type BucketMemberRole = "admin" | "contributor" | "viewer"

type BucketMemberBatchExtrinsicSubmitter = (
  endpoint: string,
  role: "admin" | "contributor",
  namespaceId: string,
  bucketId: string,
  ss58Address: string,
  x25519Key: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
) => Promise<string>

type BucketMemberRolesRemovalBatchExtrinsicSubmitter = (
  endpoint: string,
  namespaceId: string,
  bucketId: string,
  memberAddress: string,
  roles: BucketMemberRole[],
  viewerKey: string | undefined,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
) => Promise<string>

type NamespaceStorageReader = (endpoint: string) => Promise<unknown>
type BucketsStorageReader = (endpoint: string) => Promise<unknown>
type MessagesStorageReader = (endpoint: string) => Promise<unknown>

type NamespaceMemberExtrinsicSubmitter = (
  endpoint: string,
  namespaceId: string,
  memberAddress: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
) => Promise<string>

type SubmittableTx = {
  signAndSend(address: string, options: { signer: unknown; tip?: string }): Promise<{ toHex: () => string } | string>
  signAndSend(
    address: string,
    options: { signer: unknown; tip?: string },
    callback: (result: Record<string, unknown>) => void
  ): Promise<(() => void) | { toHex: () => string } | string>
}

type ExtrinsicWithEncoding = {
  method?: { toHex?: () => string }
  toHex?: () => string
}

export interface BucketNamespace {
  id: string
  name: string
  raw: unknown
}

export interface BucketRecord {
  id: string
  name: string
  namespaceId?: string
  raw: unknown
}

export interface BucketMessage {
  id: string
  bucketId?: string
  summary: string
  raw: unknown
}

export interface CreateNamespaceResult {
  txHash: string
  method: string
}

export interface CreateBucketResult {
  txHash: string
  method: string
}

export interface CreateMessageResult {
  txHash: string
  method: string
}

export interface AddBucketMemberResult {
  txHash: string
  method: string
}

export interface RotateBucketKeyBatchResult {
  txHash: string
  method: string
}

export class DidCommRepository {
  private client: PapiRpcClient
  private submitExtrinsic: ExtrinsicSubmitter
  private submitBucketExtrinsic: BucketExtrinsicSubmitter
  private submitMessageExtrinsic: MessageExtrinsicSubmitter
  private readNamespaceStorage: NamespaceStorageReader
  private readBucketsStorage: BucketsStorageReader
  private readMessagesStorage: MessagesStorageReader
  private submitAddAdminExtrinsic: BucketMemberExtrinsicSubmitter
  private submitAddContributorExtrinsic: BucketMemberExtrinsicSubmitter
  private submitAddViewerExtrinsic: BucketMemberExtrinsicSubmitter
  private submitRemoveAdminExtrinsic: BucketMemberExtrinsicSubmitter
  private submitRemoveContributorExtrinsic: BucketMemberExtrinsicSubmitter
  private submitRemoveViewerExtrinsic: BucketMemberExtrinsicSubmitter
  private submitSetBucketPublicKeyExtrinsic: BucketPublicKeyExtrinsicSubmitter
  private submitCreateTagExtrinsic: BucketTagExtrinsicSubmitter
  private submitAddNamespaceManagerExtrinsic: NamespaceMemberExtrinsicSubmitter
  private submitRemoveNamespaceManagerExtrinsic: NamespaceMemberExtrinsicSubmitter
  private submitBucketKeyRotationBatchExtrinsic: BucketKeyRotationBatchExtrinsicSubmitter
  private submitAddMemberBatchExtrinsic: BucketMemberBatchExtrinsicSubmitter
  private submitRemoveMemberBatchExtrinsic: BucketMemberRolesRemovalBatchExtrinsicSubmitter
  private pinataConfig?: PinataConfig
  private indexerUrl?: string

  constructor(
    client: PapiRpcClient = new PapiClient(),
    submitExtrinsic: ExtrinsicSubmitter = submitBucketsCreateNamespaceExtrinsic,
    submitBucketExtrinsic: BucketExtrinsicSubmitter = submitBucketsCreateBucketExtrinsic,
    readNamespaceStorage: NamespaceStorageReader = queryBucketsNamespacesStorage,
    readBucketsStorage: BucketsStorageReader = queryBucketsStorage,
    readMessagesStorage: MessagesStorageReader = queryBucketsMessagesStorage,
    submitMessageExtrinsic: MessageExtrinsicSubmitter = submitBucketsAddMessageExtrinsic,
    submitAddAdminExtrinsic: BucketMemberExtrinsicSubmitter = submitBucketsAddAdminExtrinsic,
    submitAddContributorExtrinsic: BucketMemberExtrinsicSubmitter = submitBucketsAddContributorExtrinsic,
    submitAddViewerExtrinsic: BucketMemberExtrinsicSubmitter = submitBucketsAddViewerExtrinsic,
    submitRemoveAdminExtrinsic: BucketMemberExtrinsicSubmitter = submitBucketsRemoveAdminExtrinsic,
    submitRemoveContributorExtrinsic: BucketMemberExtrinsicSubmitter = submitBucketsRemoveContributorExtrinsic,
    submitRemoveViewerExtrinsic: BucketMemberExtrinsicSubmitter = submitBucketsRemoveViewerExtrinsic,
    submitSetBucketPublicKeyExtrinsic: BucketPublicKeyExtrinsicSubmitter = submitBucketsSetPublicKeyExtrinsic,
    submitCreateTagExtrinsic: BucketTagExtrinsicSubmitter = submitBucketsCreateTagExtrinsic,
    pinataConfig?: PinataConfig,
    submitBucketKeyRotationBatchExtrinsic: BucketKeyRotationBatchExtrinsicSubmitter = submitBucketsBatchKeyRotationExtrinsic,
    submitAddNamespaceManagerExtrinsic: NamespaceMemberExtrinsicSubmitter = submitBucketsAddNamespaceManagerExtrinsic,
    submitRemoveNamespaceManagerExtrinsic: NamespaceMemberExtrinsicSubmitter = submitBucketsRemoveNamespaceManagerExtrinsic,
    indexerUrl?: string,
    submitAddMemberBatchExtrinsic: BucketMemberBatchExtrinsicSubmitter = submitBucketsAddMemberBatchExtrinsic,
    submitRemoveMemberBatchExtrinsic: BucketMemberRolesRemovalBatchExtrinsicSubmitter = submitBucketsRemoveMemberBatchExtrinsic
  ) {
    this.client = client
    this.submitExtrinsic = submitExtrinsic
    this.submitBucketExtrinsic = submitBucketExtrinsic
    this.submitMessageExtrinsic = submitMessageExtrinsic
    this.readNamespaceStorage = readNamespaceStorage
    this.readBucketsStorage = readBucketsStorage
    this.readMessagesStorage = readMessagesStorage
    this.submitAddAdminExtrinsic = submitAddAdminExtrinsic
    this.submitAddContributorExtrinsic = submitAddContributorExtrinsic
    this.submitAddViewerExtrinsic = submitAddViewerExtrinsic
    this.submitRemoveAdminExtrinsic = submitRemoveAdminExtrinsic
    this.submitRemoveContributorExtrinsic = submitRemoveContributorExtrinsic
    this.submitRemoveViewerExtrinsic = submitRemoveViewerExtrinsic
    this.submitSetBucketPublicKeyExtrinsic = submitSetBucketPublicKeyExtrinsic
    this.submitCreateTagExtrinsic = submitCreateTagExtrinsic
    this.submitAddNamespaceManagerExtrinsic = submitAddNamespaceManagerExtrinsic
    this.submitRemoveNamespaceManagerExtrinsic = submitRemoveNamespaceManagerExtrinsic
    this.submitBucketKeyRotationBatchExtrinsic = submitBucketKeyRotationBatchExtrinsic
    this.submitAddMemberBatchExtrinsic = submitAddMemberBatchExtrinsic
    this.submitRemoveMemberBatchExtrinsic = submitRemoveMemberBatchExtrinsic
    this.pinataConfig = sanitizePinataConfig(pinataConfig)
    this.indexerUrl = indexerUrl
  }

  async fetchNamespaces(): Promise<BucketNamespace[]> {
    // Try indexer first
    if (this.indexerUrl) {
      try {
        const indexed = await fetchIndexedNamespaces(this.indexerUrl)
        if (indexed.length > 0) {
          return indexed.map((n) => ({
            id: n.id,
            name: n.name ?? `Namespace ${n.id}`,
            raw: n
          }))
        }
      } catch {
        // Fallback to RPC
      }
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for buckets.namespaces storage query")
    }

    const response = await this.readNamespaceStorage(endpoint)
    return this.normalizeNamespaces(response)
  }

  async fetchBuckets(namespaceId: string): Promise<BucketRecord[]> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required to query buckets.buckets storage")
    }

    // Try indexer first
    if (this.indexerUrl) {
      try {
        const indexed = await fetchIndexedBucketsByNamespace(this.indexerUrl, trimmedNamespaceId)
        if (indexed.length > 0) {
          return indexed.map((b) => ({
            id: b.id,
            name: b.name ?? `Bucket ${b.bucketId}`,
            namespaceId: String(b.namespaceId),
            raw: b
          }))
        }
      } catch {
        // Fallback to RPC
      }
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for buckets.buckets storage query")
    }

    const response = await this.readBucketsStorage(endpoint)
    return this.normalizeBuckets(response, trimmedNamespaceId)
  }

  async fetchMessages(bucketId: string): Promise<BucketMessage[]> {
    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required to query buckets.messages storage")
    }

    // Try indexer first
    if (this.indexerUrl) {
      try {
        const indexed = await fetchIndexedMessages(this.indexerUrl, trimmedBucketId)
        if (indexed.length > 0) {
          return indexed.map((m) => ({
            id: m.id,
            bucketId: m.bucketId,
            summary: m.description ?? m.reference ?? `Message ${m.messageId}`,
            raw: m
          }))
        }
      } catch {
        // Fallback to RPC
      }
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for buckets.messages storage query")
    }

    const response = await this.readMessagesStorage(endpoint)
    return this.normalizeMessages(response, trimmedBucketId)
  }

  async fetchBucketAdmins(bucketId: string): Promise<string[]> {
    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required to query buckets.admins storage")
    }

    // Try indexer first
    if (this.indexerUrl) {
      try {
        const detail = await fetchIndexedBucketDetail(this.indexerUrl, trimmedBucketId)
        if (detail && detail.admins.length > 0) {
          return detail.admins.map((a) => a.subjectId)
        }
      } catch {
        // Fallback to RPC
      }
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for buckets.admins storage query")
    }

    return await queryBucketMemberAddressesStorage(endpoint, ["admins"], trimmedBucketId)
  }

  async fetchBucketContributors(bucketId: string): Promise<string[]> {
    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required to query buckets.contributors storage")
    }

    // Try indexer first
    if (this.indexerUrl) {
      try {
        const detail = await fetchIndexedBucketDetail(this.indexerUrl, trimmedBucketId)
        if (detail && detail.contributors.length > 0) {
          return detail.contributors.map((c) => c.subjectId)
        }
      } catch {
        // Fallback to RPC
      }
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for buckets.contributors storage query")
    }

    return await queryBucketMemberAddressesStorage(endpoint, ["contributors"], trimmedBucketId)
  }

  async fetchBucketViewers(bucketId: string): Promise<string[]> {
    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required to query buckets.viewers storage")
    }

    // Try indexer first
    if (this.indexerUrl) {
      try {
        const detail = await fetchIndexedBucketDetail(this.indexerUrl, trimmedBucketId)
        if (detail && detail.viewers.length > 0) {
          return detail.viewers.map((v) => v.subjectId)
        }
      } catch {
        // Fallback to RPC
      }
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for buckets.viewers storage query")
    }

    return await queryBucketMemberAddressesStorage(endpoint, ["viewers"], trimmedBucketId)
  }

  async fetchNamespaceManagers(namespaceId: string): Promise<string[]> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required to query buckets.managers storage")
    }

    // Try indexer first
    if (this.indexerUrl) {
      try {
        const indexed = await fetchIndexedNamespaceManagers(this.indexerUrl, trimmedNamespaceId)
        if (indexed.length > 0) {
          return indexed.map((m) => m.manager)
        }
      } catch {
        // Fallback to RPC
      }
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for buckets.managers storage query")
    }

    return await queryBucketMemberAddressesStorage(endpoint, ["managers", "namespaceManagers"], trimmedNamespaceId)
  }

  private normalizeNamespaces(response: unknown): BucketNamespace[] {
    if (Array.isArray(response)) {
      return response.map((entry, index) => this.normalizeNamespace(entry, index))
    }

    if (response && typeof response === "object" && "namespaces" in response) {
      const nested = (response as { namespaces?: unknown }).namespaces
      if (Array.isArray(nested)) {
        return nested.map((entry, index) => this.normalizeNamespace(entry, index))
      }
    }

    if (response && typeof response === "object") {
      return Object.entries(response).map(([key, value], index) =>
        this.normalizeNamespace({ id: key, value }, index)
      )
    }

    return []
  }

  private normalizeNamespace(entry: unknown, index: number): BucketNamespace {
    if (typeof entry === "string") {
      return {
        id: entry,
        name: entry,
        raw: entry
      }
    }

    if (entry && typeof entry === "object") {
      const objectEntry = entry as Record<string, unknown>
      const idCandidate = objectEntry.id ?? objectEntry.namespaceId ?? objectEntry.key ?? objectEntry.name
      const nameCandidate = objectEntry.name ?? objectEntry.namespace ?? objectEntry.label ?? idCandidate
      const decodedName = decodeUtf8HexStringIfPresent(nameCandidate)

      return {
        id: String(idCandidate ?? `namespace-${index + 1}`),
        name: decodedName ?? String(nameCandidate ?? `Namespace ${index + 1}`),
        raw: entry
      }
    }

    return {
      id: `namespace-${index + 1}`,
      name: `Namespace ${index + 1}`,
      raw: entry
    }
  }

  private normalizeBuckets(response: unknown, namespaceId: string): BucketRecord[] {
    if (!Array.isArray(response)) {
      return []
    }

    const targetNamespaceId = normalizeComparableId(namespaceId)

    return response
      .map((entry, index) => this.normalizeBucket(entry, index))
      .filter((bucket) => {
        const candidateNamespace =
          bucket.namespaceId ??
          (bucket.raw && typeof bucket.raw === "object"
            ? ((bucket.raw as Record<string, unknown>).namespaceId ?? (bucket.raw as Record<string, unknown>).namespace)
            : undefined)

        return normalizeComparableId(candidateNamespace) === targetNamespaceId
      })
  }

  async fetchBucket(bucketId: string): Promise<BucketRecord | undefined> {
    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required to query buckets.buckets storage")
    }

    // Try indexer first
    if (this.indexerUrl) {
      try {
        const numericBucketId = Number(trimmedBucketId)
        const filter = Number.isFinite(numericBucketId)
          ? { bucketId: { equalTo: numericBucketId } }
          : { id: { equalTo: trimmedBucketId } }
        const indexed = await fetchIndexedBucketsFiltered(this.indexerUrl, filter)
        if (indexed.length > 0) {
          return indexed.map((b) => ({
            id: b.id,
            name: b.name ?? `Bucket ${b.bucketId}`,
            namespaceId: String(b.namespaceId),
            raw: b
          }))[0]
        }
      } catch {
        // Fallback to RPC
      }
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for buckets.buckets storage query")
    }

    const response = await this.readBucketsStorage(endpoint)
    if (!Array.isArray(response)) {
      return undefined
    }

    const targetBucketId = normalizeComparableId(trimmedBucketId)
    return response
      .map((entry, index) => this.normalizeBucket(entry, index))
      .find((bucket) => normalizeComparableId(bucket.id) === targetBucketId)
  }

  private normalizeBucket(entry: unknown, index: number): BucketRecord {
    if (entry && typeof entry === "object") {
      const objectEntry = entry as Record<string, unknown>
      const idCandidate = objectEntry.id ?? objectEntry.bucketId ?? objectEntry.key ?? objectEntry.name
      const namespaceCandidate = objectEntry.namespaceId ?? objectEntry.namespace
      const metadataNameCandidate =
        objectEntry.metadata && typeof objectEntry.metadata === "object" && !Array.isArray(objectEntry.metadata)
          ? (objectEntry.metadata as Record<string, unknown>).name
          : undefined
      const nameCandidate = metadataNameCandidate ?? objectEntry.name ?? objectEntry.label ?? objectEntry.value ?? idCandidate
      const decodedName = decodeUtf8HexStringIfPresent(nameCandidate)

      return {
        id: String(idCandidate ?? `bucket-${index + 1}`),
        namespaceId: namespaceCandidate !== undefined ? String(namespaceCandidate) : undefined,
        name: decodedName ?? String(nameCandidate ?? `Bucket ${index + 1}`),
        raw: entry
      }
    }

    const fallbackId = `bucket-${index + 1}`
    return {
      id: fallbackId,
      name: fallbackId,
      raw: entry
    }
  }

  private normalizeMessages(response: unknown, bucketId: string): BucketMessage[] {
    if (!Array.isArray(response)) {
      return []
    }

    const targetBucketId = normalizeComparableId(bucketId)

    return response
      .map((entry, index) => this.normalizeMessage(entry, index))
      .filter((message) => {
        const candidateBucketId =
          message.bucketId ??
          (message.raw && typeof message.raw === "object"
            ? ((message.raw as Record<string, unknown>).bucketId ?? (message.raw as Record<string, unknown>).bucket)
            : undefined)

        return normalizeComparableId(candidateBucketId) === targetBucketId
      })
  }

  private normalizeMessage(entry: unknown, index: number): BucketMessage {
    if (entry && typeof entry === "object") {
      const objectEntry = entry as Record<string, unknown>
      const idCandidate = objectEntry.id ?? objectEntry.messageId ?? objectEntry.key
      const bucketCandidate = objectEntry.bucketId ?? objectEntry.bucket
      const summaryCandidate =
        objectEntry.summary ?? objectEntry.message ?? objectEntry.content ?? objectEntry.payload ?? idCandidate
      const decodedSummary = decodeUtf8HexStringIfPresent(summaryCandidate)

      return {
        id: String(idCandidate ?? `message-${index + 1}`),
        bucketId: bucketCandidate !== undefined ? String(bucketCandidate) : undefined,
        summary: decodedSummary ?? String(summaryCandidate ?? `Message ${index + 1}`),
        raw: entry
      }
    }

    const fallbackId = `message-${index + 1}`
    return {
      id: fallbackId,
      summary: String(entry ?? fallbackId),
      raw: entry
    }
  }

  async setBucketPublicKey(
    namespaceId: string,
    bucketId: string,
    newEncryptionKey: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<string> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required")
    }

    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required")
    }

    const trimmedNewEncryptionKey = newEncryptionKey.trim()
    if (!trimmedNewEncryptionKey) {
      throw new Error("New encryption key is required")
    }

    const normalizedEncryptionKey = normalizeFixed32ByteKey(trimmedNewEncryptionKey)

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.resumeWriting extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    return await this.submitSetBucketPublicKeyExtrinsic(
      endpoint,
      trimmedNamespaceId,
      trimmedBucketId,
      normalizedEncryptionKey,
      ownerAddress,
      onUpdate
    )
  }

  async createTag(bucketId: string, tag: string, ownerAddress?: string, onUpdate?: ExtrinsicUpdateHandler): Promise<string> {
    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required")
    }

    const trimmedTag = tag.trim()
    if (!trimmedTag) {
      throw new Error("Tag is required")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.createTag extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    return await this.submitCreateTagExtrinsic(endpoint, trimmedBucketId, trimmedTag, ownerAddress, onUpdate)
  }

  async createNamespace(
    namespaceName: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<CreateNamespaceResult> {
    const trimmedName = namespaceName.trim()
    if (!trimmedName) {
      throw new Error("Namespace name is required")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.createNamespace extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    const txHash = await this.submitExtrinsic(endpoint, trimmedName, ownerAddress, onUpdate)
    return {
      txHash,
      method: "buckets.createNamespace"
    }
  }

  async createBucket(
    namespaceId: string,
    bucketName: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler,
    category?: string
  ): Promise<CreateBucketResult> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required")
    }

    const trimmedBucketName = bucketName.trim()
    if (!trimmedBucketName) {
      throw new Error("Bucket name is required")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.createBucket extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    const txHash = await this.submitBucketExtrinsic(endpoint, trimmedNamespaceId, trimmedBucketName, ownerAddress, onUpdate, category?.trim())
    return {
      txHash,
      method: "buckets.createBucket"
    }
  }

  async createMessage(
    bucketId: string,
    message: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler,
    tag?: string,
    contentType?: string
  ): Promise<CreateMessageResult> {
    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required")
    }

    const trimmedMessage = message.trim()
    if (!trimmedMessage) {
      throw new Error("Message is required")
    }

    const trimmedTag = typeof tag === "string" ? tag.trim() : ""
    const trimmedContentType = typeof contentType === "string" ? contentType.trim() : ""

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.write extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    const txHash = await this.submitMessageExtrinsic(
      endpoint,
      trimmedBucketId,
      trimmedMessage,
      ownerAddress,
      onUpdate,
      trimmedTag || undefined,
      this.pinataConfig,
      trimmedContentType || undefined
    )
    return {
      txHash,
      method: "buckets.write"
    }
  }

  async createFileMessage(
    bucketId: string,
    fileJwe: string,
    fileContentType: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<CreateMessageResult> {
    const trimmedFileJwe = fileJwe.trim()
    if (!trimmedFileJwe) {
      throw new Error("File payload is required")
    }

    const trimmedContentType = fileContentType.trim() || "application/octet-stream"

    // The standard write flow uploads the message content to IPFS and stores its
    // CID as the on-chain reference, so the reference points straight at the file JWE.
    return this.createMessage(bucketId, trimmedFileJwe, ownerAddress, onUpdate, undefined, trimmedContentType)
  }

  async rotateBucketKeyAndShare(
    namespaceId: string,
    bucketId: string,
    newEncryptionKey: string,
    tag: string,
    message: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<RotateBucketKeyBatchResult> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required")
    }

    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required")
    }

    const normalizedEncryptionKey = normalizeFixed32ByteKey(newEncryptionKey.trim())
    const trimmedTag = tag.trim()
    if (!trimmedTag) {
      throw new Error("Tag is required")
    }

    const trimmedMessage = message.trim()
    if (!trimmedMessage) {
      throw new Error("Message is required")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit utility.batchAll extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    const txHash = await this.submitBucketKeyRotationBatchExtrinsic(
      endpoint,
      trimmedNamespaceId,
      trimmedBucketId,
      normalizedEncryptionKey,
      trimmedTag,
      trimmedMessage,
      ownerAddress,
      onUpdate,
      this.pinataConfig
    )

    return {
      txHash,
      method: "utility.batchAll"
    }
  }

  async addBucketAdmin(
    namespaceId: string,
    bucketId: string,
    memberAddress: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<AddBucketMemberResult> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required")
    }

    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required")
    }

    const trimmedMemberAddress = memberAddress.trim()
    if (!trimmedMemberAddress) {
      throw new Error("Member address is required")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.addAdmin extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    const txHash = await this.submitAddAdminExtrinsic(
      endpoint,
      trimmedNamespaceId,
      trimmedBucketId,
      trimmedMemberAddress,
      ownerAddress,
      onUpdate
    )
    return {
      txHash,
      method: "buckets.addAdmin"
    }
  }

  async addBucketContributor(
    namespaceId: string,
    bucketId: string,
    memberAddress: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<AddBucketMemberResult> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required")
    }

    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required")
    }

    const trimmedMemberAddress = memberAddress.trim()
    if (!trimmedMemberAddress) {
      throw new Error("Member address is required")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.addContributor extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    const txHash = await this.submitAddContributorExtrinsic(
      endpoint,
      trimmedNamespaceId,
      trimmedBucketId,
      trimmedMemberAddress,
      ownerAddress,
      onUpdate
    )
    return {
      txHash,
      method: "buckets.addContributor"
    }
  }

  async addBucketViewer(
    namespaceId: string,
    bucketId: string,
    memberAddress: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<AddBucketMemberResult> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required")
    }

    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required")
    }

    const trimmedMemberAddress = memberAddress.trim()
    if (!trimmedMemberAddress) {
      throw new Error("Member address is required")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.addViewer extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    const txHash = await this.submitAddViewerExtrinsic(
      endpoint,
      trimmedNamespaceId,
      trimmedBucketId,
      trimmedMemberAddress,
      ownerAddress,
      onUpdate
    )
    return {
      txHash,
      method: "buckets.addViewer"
    }
  }

  async addBucketMemberWithRole(
    role: BucketMemberRole,
    namespaceId: string,
    bucketId: string,
    ss58Address: string,
    x25519Key: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<AddBucketMemberResult> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required")
    }

    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required")
    }

    const trimmedSs58Address = ss58Address.trim()
    if (!trimmedSs58Address) {
      throw new Error("Member address is required")
    }

    const trimmedX25519Key = x25519Key.trim()
    if (!trimmedX25519Key) {
      // Every role adds a viewer, and the viewer call needs the X25519 key from the profile.
      throw new Error("X25519 key is required")
    }

    // The chain's viewer field is a fixed [u8;32]. Profiles store the X25519 public key as a
    // base64url JWK "x" value (43 chars), so decode it to a 32-byte hex string before submitting.
    const viewerKeyHex = normalizeFixed32ByteKey(trimmedX25519Key)

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit bucket member extrinsics")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    if (role === "viewer") {
      const txHash = await this.submitAddViewerExtrinsic(
        endpoint,
        trimmedNamespaceId,
        trimmedBucketId,
        viewerKeyHex,
        ownerAddress,
        onUpdate
      )
      return {
        txHash,
        method: "buckets.addViewer"
      }
    }

    const txHash = await this.submitAddMemberBatchExtrinsic(
      endpoint,
      role,
      trimmedNamespaceId,
      trimmedBucketId,
      trimmedSs58Address,
      viewerKeyHex,
      ownerAddress,
      onUpdate
    )
    return {
      txHash,
      method: "utility.batchAll"
    }
  }

  async removeBucketAdmin(
    namespaceId: string,
    bucketId: string,
    memberAddress: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<AddBucketMemberResult> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required")
    }

    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required")
    }

    const trimmedMemberAddress = memberAddress.trim()
    if (!trimmedMemberAddress) {
      throw new Error("Member address is required")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.removeAdmin extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    const txHash = await this.submitRemoveAdminExtrinsic(
      endpoint,
      trimmedNamespaceId,
      trimmedBucketId,
      trimmedMemberAddress,
      ownerAddress,
      onUpdate
    )

    return {
      txHash,
      method: "buckets.removeAdmin"
    }
  }

  async removeBucketContributor(
    namespaceId: string,
    bucketId: string,
    memberAddress: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<AddBucketMemberResult> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required")
    }

    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required")
    }

    const trimmedMemberAddress = memberAddress.trim()
    if (!trimmedMemberAddress) {
      throw new Error("Member address is required")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.removeContributor extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    const txHash = await this.submitRemoveContributorExtrinsic(
      endpoint,
      trimmedNamespaceId,
      trimmedBucketId,
      trimmedMemberAddress,
      ownerAddress,
      onUpdate
    )

    return {
      txHash,
      method: "buckets.removeContributor"
    }
  }

  async removeBucketViewer(
    namespaceId: string,
    bucketId: string,
    memberAddress: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<AddBucketMemberResult> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required")
    }

    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required")
    }

    const trimmedMemberAddress = memberAddress.trim()
    if (!trimmedMemberAddress) {
      throw new Error("Member address is required")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.removeViewer extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    const txHash = await this.submitRemoveViewerExtrinsic(
      endpoint,
      trimmedNamespaceId,
      trimmedBucketId,
      trimmedMemberAddress,
      ownerAddress,
      onUpdate
    )

    return {
      txHash,
      method: "buckets.removeViewer"
    }
  }

  async removeBucketMemberRoles(
    namespaceId: string,
    bucketId: string,
    memberAddress: string,
    roles: BucketMemberRole[],
    viewerKey?: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<AddBucketMemberResult> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required")
    }

    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required")
    }

    const trimmedMemberAddress = memberAddress.trim()
    if (!trimmedMemberAddress) {
      throw new Error("Member address is required")
    }

    // Deduplicate while preserving a stable admin -> contributor -> viewer order.
    const orderedRoles: BucketMemberRole[] = (["admin", "contributor", "viewer"] as const).filter((role) =>
      roles.includes(role)
    )
    if (!orderedRoles.length) {
      throw new Error("At least one role is required to remove a member")
    }

    // Viewers are keyed on-chain by their X25519 key, not their SS58 address.
    const trimmedViewerKey = viewerKey?.trim()
    if (orderedRoles.includes("viewer") && !trimmedViewerKey) {
      throw new Error("Viewer key is required to remove a viewer")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit utility.batchAll extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    const txHash = await this.submitRemoveMemberBatchExtrinsic(
      endpoint,
      trimmedNamespaceId,
      trimmedBucketId,
      trimmedMemberAddress,
      orderedRoles,
      trimmedViewerKey,
      ownerAddress,
      onUpdate
    )

    return {
      txHash,
      method: "utility.batchAll"
    }
  }

  async addNamespaceManager(
    namespaceId: string,
    memberAddress: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<AddBucketMemberResult> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required")
    }

    const trimmedMemberAddress = memberAddress.trim()
    if (!trimmedMemberAddress) {
      throw new Error("Member address is required")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.addNamespaceManager extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    const txHash = await this.submitAddNamespaceManagerExtrinsic(
      endpoint,
      trimmedNamespaceId,
      trimmedMemberAddress,
      ownerAddress,
      onUpdate
    )
    return {
      txHash,
      method: "buckets.addNamespaceManager"
    }
  }

  async removeNamespaceManager(
    namespaceId: string,
    memberAddress: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<AddBucketMemberResult> {
    const trimmedNamespaceId = namespaceId.trim()
    if (!trimmedNamespaceId) {
      throw new Error("Namespace id is required")
    }

    const trimmedMemberAddress = memberAddress.trim()
    if (!trimmedMemberAddress) {
      throw new Error("Member address is required")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.removeNamespaceManager extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    const txHash = await this.submitRemoveNamespaceManagerExtrinsic(
      endpoint,
      trimmedNamespaceId,
      trimmedMemberAddress,
      ownerAddress,
      onUpdate
    )

    return {
      txHash,
      method: "buckets.removeNamespaceManager"
    }
  }
}

async function submitBucketsCreateNamespaceExtrinsic(
  endpoint: string,
  namespaceName: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  const [{ ApiPromise, WsProvider }, { web3FromAddress }] = await Promise.all([
    import("@polkadot/api"),
    import("@polkadot/extension-dapp")
  ])

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const buckets = (api.tx as Record<string, unknown>).buckets as Record<string, unknown> | undefined
    const createNamespace = buckets?.createNamespace as ((input: unknown) => unknown) | undefined

    if (!createNamespace) {
      throw new Error("buckets.createNamespace extrinsic is not available on this chain")
    }

    const injector = await web3FromAddress(ownerAddress)
    const metadataInput = {
      name: utf8ToHexBytes(namespaceName),
      category: null,
      schemaUri: null,
      properties: {}
    }

    const tx = createNamespace(metadataInput) as SubmittableTx
    logEncodedCallBytes("buckets.createNamespace", tx)

    const attemptTips = ["0", "1000000", "2000000"]
    let lastError: Error | null = null

    for (let attempt = 0; attempt < attemptTips.length; attempt += 1) {
      const tip = attemptTips[attempt]!

      try {
        if (attempt > 0) {
          onUpdate?.({
            stage: "submitted",
            message: `Retrying extrinsic with higher priority fee (tip=${tip})`
          })
        }

        return await submitWithTip(tx, ownerAddress, injector.signer, tip, onUpdate, api)
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error("Extrinsic submission failed")
        lastError = normalized

        if (!isLowPriorityTransactionError(normalized) || attempt === attemptTips.length - 1) {
          throw normalized
        }
      }
    }

    throw lastError ?? new Error("Extrinsic submission failed")
  } finally {
    await api.disconnect()
  }
}

async function submitBucketsCreateBucketExtrinsic(
  endpoint: string,
  namespaceId: string,
  bucketName: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler,
  category?: string
): Promise<string> {
  const [{ ApiPromise, WsProvider }, { web3FromAddress }] = await Promise.all([
    import("@polkadot/api"),
    import("@polkadot/extension-dapp")
  ])

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const buckets = (api.tx as Record<string, unknown>).buckets as Record<string, unknown> | undefined
    const createBucket = buckets?.createBucket as ((namespace: unknown, metadata: unknown) => unknown) | undefined

    if (!createBucket) {
      throw new Error("buckets.createBucket extrinsic is not available on this chain")
    }

    const injector = await web3FromAddress(ownerAddress)
    const metadataInput = {
      name: utf8ToHexBytes(bucketName),
      category: category ? utf8ToHexBytes(category) : null,
      schemaUri: null,
      properties: {}
    }

    const tx = createBucket(namespaceId, metadataInput) as SubmittableTx
    logEncodedCallBytes("buckets.createBucket", tx)

    const attemptTips = ["0", "1000000", "2000000"]
    let lastError: Error | null = null

    for (let attempt = 0; attempt < attemptTips.length; attempt += 1) {
      const tip = attemptTips[attempt]!

      try {
        if (attempt > 0) {
          onUpdate?.({
            stage: "submitted",
            message: `Retrying extrinsic with higher priority fee (tip=${tip})`
          })
        }

        return await submitWithTip(tx, ownerAddress, injector.signer, tip, onUpdate, api)
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error("Extrinsic submission failed")
        lastError = normalized

        if (!isLowPriorityTransactionError(normalized) || attempt === attemptTips.length - 1) {
          throw normalized
        }
      }
    }

    throw lastError ?? new Error("Extrinsic submission failed")
  } finally {
    await api.disconnect()
  }
}

async function submitBucketsAddMessageExtrinsic(
  endpoint: string,
  bucketId: string,
  message: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler,
  tag?: string,
  pinataConfig?: PinataConfig,
  contentType?: string
): Promise<string> {
  const [{ ApiPromise, WsProvider }, { web3FromAddress }] = await Promise.all([
    import("@polkadot/api"),
    import("@polkadot/extension-dapp")
  ])

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const buckets = (api.tx as Record<string, unknown>).buckets as Record<string, unknown> | undefined
    const write = resolveBucketsArbitraryTxMethod(buckets, ["write"])
    const addMessage = resolveBucketsArbitraryTxMethod(buckets, ["addMessage"])

    if (!write && !addMessage) {
      throw new Error("Neither buckets.write nor buckets.addMessage extrinsic is available on this chain")
    }

    const injector = await web3FromAddress(ownerAddress)
    let tx: SubmittableTx
    let submittedCallName = "buckets.addMessage"
    if (write) {
      const namespaceId = await resolveNamespaceIdForBucketWrite(api, bucketId)
      const resolvedPinataConfig = resolvePinataConfig(pinataConfig)
      const storageAdapter = new PinataStorageAdapter(resolvedPinataConfig)
      console.log("PinataAdapter: Uploading message reference content to IPFS before buckets.write...")
      let cid = ""
      try {
        cid = await storageAdapter.upload(message)
      } catch (error) {
        const details = error instanceof Error ? error.message : "Unknown upload error"
        const failureMessage = `IPFS upload failed; aborting buckets.write submission. ${details}`
        onUpdate?.({
          stage: "error",
          message: failureMessage
        })
        throw new Error(failureMessage)
      }
      console.log(`PinataAdapter: Using CID as on-chain reference: ${cid}`)
      const messageInput = await buildBucketsWriteMessageInput(cid, message, tag, contentType)
      tx = write(namespaceId, bucketId, messageInput) as SubmittableTx
      submittedCallName = "buckets.write"
    } else {
      tx = addMessage!(bucketId, utf8ToHexBytes(message)) as SubmittableTx
    }
    logEncodedCallBytes(submittedCallName, tx)

    const attemptTips = ["0", "1000000", "2000000"]
    let lastError: Error | null = null

    for (let attempt = 0; attempt < attemptTips.length; attempt += 1) {
      const tip = attemptTips[attempt]!

      try {
        if (attempt > 0) {
          onUpdate?.({
            stage: "submitted",
            message: `Retrying extrinsic with higher priority fee (tip=${tip})`
          })
        }

        return await submitWithTip(tx, ownerAddress, injector.signer, tip, onUpdate, api)
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error("Extrinsic submission failed")
        lastError = normalized

        if (!isLowPriorityTransactionError(normalized) || attempt === attemptTips.length - 1) {
          throw normalized
        }
      }
    }

    throw lastError ?? new Error("Extrinsic submission failed")
  } finally {
    await api.disconnect()
  }
}

async function submitBucketsSetPublicKeyExtrinsic(
  endpoint: string,
  namespaceId: string,
  bucketId: string,
  newEncryptionKey: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  const [{ ApiPromise, WsProvider }, { web3FromAddress }] = await Promise.all([
    import("@polkadot/api"),
    import("@polkadot/extension-dapp")
  ])

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const buckets = (api.tx as Record<string, unknown>).buckets as Record<string, unknown> | undefined
    const resumeWriting = resolveBucketsArbitraryTxMethod(buckets, ["resumeWriting"])
    if (!resumeWriting) {
      throw new Error("buckets.resumeWriting extrinsic is not available on this chain")
    }

    const injector = await web3FromAddress(ownerAddress)
    const tx = resumeWriting(namespaceId, bucketId, newEncryptionKey) as SubmittableTx
    logEncodedCallBytes("buckets.resumeWriting", tx)

    const attemptTips = ["0", "1000000", "2000000"]
    let lastError: Error | null = null

    for (let attempt = 0; attempt < attemptTips.length; attempt += 1) {
      const tip = attemptTips[attempt]!

      try {
        if (attempt > 0) {
          onUpdate?.({
            stage: "submitted",
            message: `Retrying extrinsic with higher priority fee (tip=${tip})`
          })
        }

        return await submitWithTip(tx, ownerAddress, injector.signer, tip, onUpdate, api)
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error("Extrinsic submission failed")
        lastError = normalized

        if (!isLowPriorityTransactionError(normalized) || attempt === attemptTips.length - 1) {
          throw normalized
        }
      }
    }

    throw lastError ?? new Error("Extrinsic submission failed")
  } finally {
    await api.disconnect()
  }
}

async function submitBucketsBatchKeyRotationExtrinsic(
  endpoint: string,
  namespaceId: string,
  bucketId: string,
  newEncryptionKey: string,
  tag: string,
  message: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler,
  pinataConfig?: PinataConfig
): Promise<string> {
  const [{ ApiPromise, WsProvider }, { web3FromAddress }] = await Promise.all([
    import("@polkadot/api"),
    import("@polkadot/extension-dapp")
  ])

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const txRoot = api.tx as Record<string, unknown>
    const utility = txRoot.utility as Record<string, unknown> | undefined
    const batchAll = utility?.batchAll as ((calls: unknown[]) => unknown) | undefined
    if (!batchAll) {
      throw new Error("utility.batchAll extrinsic is not available on this chain")
    }

    const buckets = txRoot.buckets as Record<string, unknown> | undefined
    const resumeWriting = resolveBucketsArbitraryTxMethod(buckets, ["resumeWriting"])
    const createTag = resolveBucketsArbitraryTxMethod(buckets, ["createTag", "addTag"])
    const write = resolveBucketsArbitraryTxMethod(buckets, ["write"])

    if (!resumeWriting) {
      throw new Error("buckets.resumeWriting extrinsic is not available on this chain")
    }
    if (!createTag) {
      throw new Error("buckets.createTag extrinsic is not available on this chain")
    }
    if (!write) {
      throw new Error("buckets.write extrinsic is not available on this chain")
    }

    const resolvedPinataConfig = resolvePinataConfig(pinataConfig)
    const storageAdapter = new PinataStorageAdapter(resolvedPinataConfig)
    console.log("PinataAdapter: Uploading message reference content to IPFS before utility.batchAll...")
    const cid = await storageAdapter.upload(message)
    console.log(`PinataAdapter: Using CID as on-chain reference: ${cid}`)

    const messageInput = await buildBucketsWriteMessageInput(cid, message, tag)
    const calls = [
      resumeWriting(namespaceId, bucketId, newEncryptionKey),
      createTag(bucketId, utf8ToHexBytes(tag)),
      write(namespaceId, bucketId, messageInput)
    ]

    const tx = batchAll(calls) as SubmittableTx
    logEncodedCallBytes("utility.batchAll", tx)

    const injector = await web3FromAddress(ownerAddress)
    const attemptTips = ["0", "1000000", "2000000"]
    let lastError: Error | null = null

    for (let attempt = 0; attempt < attemptTips.length; attempt += 1) {
      const tip = attemptTips[attempt]!

      try {
        if (attempt > 0) {
          onUpdate?.({
            stage: "submitted",
            message: `Retrying extrinsic with higher priority fee (tip=${tip})`
          })
        }

        return await submitWithTip(tx, ownerAddress, injector.signer, tip, onUpdate, api)
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error("Extrinsic submission failed")
        lastError = normalized

        if (!isLowPriorityTransactionError(normalized) || attempt === attemptTips.length - 1) {
          throw normalized
        }
      }
    }

    throw lastError ?? new Error("Extrinsic submission failed")
  } finally {
    await api.disconnect()
  }
}

async function submitBucketsAddMemberBatchExtrinsic(
  endpoint: string,
  role: "admin" | "contributor",
  namespaceId: string,
  bucketId: string,
  ss58Address: string,
  x25519Key: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  const [{ ApiPromise, WsProvider }, { web3FromAddress }] = await Promise.all([
    import("@polkadot/api"),
    import("@polkadot/extension-dapp")
  ])

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const txRoot = api.tx as Record<string, unknown>
    const utility = txRoot.utility as Record<string, unknown> | undefined
    const batchAll = utility?.batchAll as ((calls: unknown[]) => unknown) | undefined
    if (!batchAll) {
      throw new Error("utility.batchAll extrinsic is not available on this chain")
    }

    const buckets = txRoot.buckets as Record<string, unknown> | undefined
    const addAdmin = resolveBucketsTxMethod(buckets, ["addAdmin", "addBucketAdmin"])
    const addContributor = resolveBucketsTxMethod(buckets, ["addContributor"])
    const addViewer = resolveBucketsTxMethod(buckets, ["addViewer"])

    if (!addContributor) {
      throw new Error("buckets.addContributor extrinsic is not available on this chain")
    }
    if (!addViewer) {
      throw new Error("buckets.addViewer extrinsic is not available on this chain")
    }
    if (role === "admin" && !addAdmin) {
      throw new Error("buckets.addAdmin extrinsic is not available on this chain")
    }

    // Admin adds all three roles; contributor adds contributor + viewer.
    // The viewer call takes the member's X25519 public key, the others take the SS58 address.
    const calls: unknown[] = []
    if (role === "admin") {
      calls.push(addAdmin!(namespaceId, bucketId, ss58Address))
    }
    calls.push(addContributor(namespaceId, bucketId, ss58Address))
    calls.push(addViewer(namespaceId, bucketId, x25519Key))

    const tx = batchAll(calls) as SubmittableTx
    logEncodedCallBytes("utility.batchAll", tx)

    const injector = await web3FromAddress(ownerAddress)
    const attemptTips = ["0", "1000000", "2000000"]
    let lastError: Error | null = null

    for (let attempt = 0; attempt < attemptTips.length; attempt += 1) {
      const tip = attemptTips[attempt]!

      try {
        if (attempt > 0) {
          onUpdate?.({
            stage: "submitted",
            message: `Retrying extrinsic with higher priority fee (tip=${tip})`
          })
        }

        return await submitWithTip(tx, ownerAddress, injector.signer, tip, onUpdate, api)
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error("Extrinsic submission failed")
        lastError = normalized

        if (!isLowPriorityTransactionError(normalized) || attempt === attemptTips.length - 1) {
          throw normalized
        }
      }
    }

    throw lastError ?? new Error("Extrinsic submission failed")
  } finally {
    await api.disconnect()
  }
}

async function submitBucketsRemoveMemberBatchExtrinsic(
  endpoint: string,
  namespaceId: string,
  bucketId: string,
  memberAddress: string,
  roles: BucketMemberRole[],
  viewerKey: string | undefined,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  const [{ ApiPromise, WsProvider }, { web3FromAddress }] = await Promise.all([
    import("@polkadot/api"),
    import("@polkadot/extension-dapp")
  ])

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const txRoot = api.tx as Record<string, unknown>
    const utility = txRoot.utility as Record<string, unknown> | undefined
    const batchAll = utility?.batchAll as ((calls: unknown[]) => unknown) | undefined
    if (!batchAll) {
      throw new Error("utility.batchAll extrinsic is not available on this chain")
    }

    const buckets = txRoot.buckets as Record<string, unknown> | undefined
    const removeByRole: Record<BucketMemberRole, string[]> = {
      admin: ["removeAdmin", "removeBucketAdmin"],
      contributor: ["removeContributor"],
      viewer: ["removeViewer"]
    }

    // Admin/contributor remove calls take the SS58 address; the viewer call is keyed
    // on-chain by the member's X25519 key.
    const calls: unknown[] = []
    for (const role of roles) {
      const removeCall = resolveBucketsTxMethod(buckets, removeByRole[role])
      if (!removeCall) {
        throw new Error(`buckets.${removeByRole[role][0]} extrinsic is not available on this chain`)
      }
      const subject = role === "viewer" ? viewerKey : memberAddress
      if (!subject) {
        throw new Error("Viewer key is required to remove a viewer")
      }
      calls.push(removeCall(namespaceId, bucketId, subject))
    }

    if (!calls.length) {
      throw new Error("At least one role is required to remove a member")
    }

    const tx = batchAll(calls) as SubmittableTx
    logEncodedCallBytes("utility.batchAll", tx)

    const injector = await web3FromAddress(ownerAddress)
    const attemptTips = ["0", "1000000", "2000000"]
    let lastError: Error | null = null

    for (let attempt = 0; attempt < attemptTips.length; attempt += 1) {
      const tip = attemptTips[attempt]!

      try {
        if (attempt > 0) {
          onUpdate?.({
            stage: "submitted",
            message: `Retrying extrinsic with higher priority fee (tip=${tip})`
          })
        }

        return await submitWithTip(tx, ownerAddress, injector.signer, tip, onUpdate, api)
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error("Extrinsic submission failed")
        lastError = normalized

        if (!isLowPriorityTransactionError(normalized) || attempt === attemptTips.length - 1) {
          throw normalized
        }
      }
    }

    throw lastError ?? new Error("Extrinsic submission failed")
  } finally {
    await api.disconnect()
  }
}

async function submitBucketsCreateTagExtrinsic(
  endpoint: string,
  bucketId: string,
  tag: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  const [{ ApiPromise, WsProvider }, { web3FromAddress }] = await Promise.all([
    import("@polkadot/api"),
    import("@polkadot/extension-dapp")
  ])

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const buckets = (api.tx as Record<string, unknown>).buckets as Record<string, unknown> | undefined
    const createTag = resolveBucketsArbitraryTxMethod(buckets, ["createTag", "addTag"])

    if (!createTag) {
      throw new Error("buckets.createTag extrinsic is not available on this chain")
    }

    const injector = await web3FromAddress(ownerAddress)
    const tx = createTag(bucketId, utf8ToHexBytes(tag)) as SubmittableTx
    logEncodedCallBytes("buckets.createTag", tx)

    const attemptTips = ["0", "1000000", "2000000"]
    let lastError: Error | null = null

    for (let attempt = 0; attempt < attemptTips.length; attempt += 1) {
      const tip = attemptTips[attempt]!

      try {
        if (attempt > 0) {
          onUpdate?.({
            stage: "submitted",
            message: `Retrying extrinsic with higher priority fee (tip=${tip})`
          })
        }

        return await submitWithTip(tx, ownerAddress, injector.signer, tip, onUpdate, api)
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error("Extrinsic submission failed")
        lastError = normalized

        if (!isLowPriorityTransactionError(normalized) || attempt === attemptTips.length - 1) {
          throw normalized
        }
      }
    }

    throw lastError ?? new Error("Extrinsic submission failed")
  } finally {
    await api.disconnect()
  }
}

async function submitBucketsAddAdminExtrinsic(
  endpoint: string,
  namespaceId: string,
  bucketId: string,
  memberAddress: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  return await submitBucketsAddMemberExtrinsic(
    endpoint,
    namespaceId,
    bucketId,
    memberAddress,
    ownerAddress,
    ["addAdmin", "addBucketAdmin"],
    "buckets.addAdmin",
    onUpdate
  )
}

async function submitBucketsAddContributorExtrinsic(
  endpoint: string,
  namespaceId: string,
  bucketId: string,
  memberAddress: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  return await submitBucketsAddMemberExtrinsic(
    endpoint,
    namespaceId,
    bucketId,
    memberAddress,
    ownerAddress,
    ["addContributor"],
    "buckets.addContributor",
    onUpdate
  )
}

async function submitBucketsAddViewerExtrinsic(
  endpoint: string,
  namespaceId: string,
  bucketId: string,
  memberAddress: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  return await submitBucketsAddMemberExtrinsic(
    endpoint,
    namespaceId,
    bucketId,
    memberAddress,
    ownerAddress,
    ["addViewer"],
    "buckets.addViewer",
    onUpdate
  )
}

async function submitBucketsRemoveAdminExtrinsic(
  endpoint: string,
  namespaceId: string,
  bucketId: string,
  memberAddress: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  return await submitBucketsAddMemberExtrinsic(
    endpoint,
    namespaceId,
    bucketId,
    memberAddress,
    ownerAddress,
    ["removeAdmin", "removeBucketAdmin"],
    "buckets.removeAdmin",
    onUpdate
  )
}

async function submitBucketsRemoveContributorExtrinsic(
  endpoint: string,
  namespaceId: string,
  bucketId: string,
  memberAddress: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  return await submitBucketsAddMemberExtrinsic(
    endpoint,
    namespaceId,
    bucketId,
    memberAddress,
    ownerAddress,
    ["removeContributor"],
    "buckets.removeContributor",
    onUpdate
  )
}

async function submitBucketsAddNamespaceManagerExtrinsic(
  endpoint: string,
  namespaceId: string,
  memberAddress: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  return await submitBucketsAddNamespaceMemberExtrinsic(
    endpoint,
    namespaceId,
    memberAddress,
    ownerAddress,
    ["addNamespaceManager", "addManager"],
    "buckets.addNamespaceManager",
    onUpdate
  )
}

async function submitBucketsRemoveViewerExtrinsic(
  endpoint: string,
  namespaceId: string,
  bucketId: string,
  memberAddress: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  return await submitBucketsAddMemberExtrinsic(
    endpoint,
    namespaceId,
    bucketId,
    memberAddress,
    ownerAddress,
    ["removeViewer"],
    "buckets.removeViewer",
    onUpdate
  )
}

async function submitBucketsRemoveNamespaceManagerExtrinsic(
  endpoint: string,
  namespaceId: string,
  memberAddress: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  return await submitBucketsAddNamespaceMemberExtrinsic(
    endpoint,
    namespaceId,
    memberAddress,
    ownerAddress,
    ["removeNamespaceManager", "removeManager"],
    "buckets.removeNamespaceManager",
    onUpdate
  )
}

async function submitBucketsAddNamespaceMemberExtrinsic(
  endpoint: string,
  namespaceId: string,
  memberAddress: string,
  ownerAddress: string,
  candidateMethodNames: string[],
  fallbackMethodLabel: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  const [{ ApiPromise, WsProvider }, { web3FromAddress }] = await Promise.all([
    import("@polkadot/api"),
    import("@polkadot/extension-dapp")
  ])

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const buckets = (api.tx as Record<string, unknown>).buckets as Record<string, unknown> | undefined
    const addMember = resolveBucketsArbitraryTxMethod(buckets, candidateMethodNames)

    if (!addMember) {
      throw new Error(`${fallbackMethodLabel} extrinsic is not available on this chain`)
    }

    const injector = await web3FromAddress(ownerAddress)
    const tx = addMember(namespaceId, memberAddress) as SubmittableTx
    logEncodedCallBytes(fallbackMethodLabel, tx)

    const attemptTips = ["0", "1000000", "2000000"]
    let lastError: Error | null = null

    for (let attempt = 0; attempt < attemptTips.length; attempt += 1) {
      const tip = attemptTips[attempt]!

      try {
        if (attempt > 0) {
          onUpdate?.({
            stage: "submitted",
            message: `Retrying extrinsic with higher priority fee (tip=${tip})`
          })
        }

        return await submitWithTip(tx, ownerAddress, injector.signer, tip, onUpdate, api)
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error("Extrinsic submission failed")
        lastError = normalized

        if (!isLowPriorityTransactionError(normalized) || attempt === attemptTips.length - 1) {
          throw normalized
        }
      }
    }

    throw lastError ?? new Error("Extrinsic submission failed")
  } finally {
    await api.disconnect()
  }
}

async function submitBucketsAddMemberExtrinsic(
  endpoint: string,
  namespaceId: string,
  bucketId: string,
  memberAddress: string,
  ownerAddress: string,
  candidateMethodNames: string[],
  fallbackMethodLabel: string,
  onUpdate?: ExtrinsicUpdateHandler
): Promise<string> {
  const [{ ApiPromise, WsProvider }, { web3FromAddress }] = await Promise.all([
    import("@polkadot/api"),
    import("@polkadot/extension-dapp")
  ])

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const buckets = (api.tx as Record<string, unknown>).buckets as Record<string, unknown> | undefined
    const addMember = resolveBucketsTxMethod(buckets, candidateMethodNames)

    if (!addMember) {
      throw new Error(`${fallbackMethodLabel} extrinsic is not available on this chain`)
    }

    const injector = await web3FromAddress(ownerAddress)
    const tx = addMember(namespaceId, bucketId, memberAddress) as SubmittableTx
    logEncodedCallBytes(fallbackMethodLabel, tx)

    const attemptTips = ["0", "1000000", "2000000"]
    let lastError: Error | null = null

    for (let attempt = 0; attempt < attemptTips.length; attempt += 1) {
      const tip = attemptTips[attempt]!

      try {
        if (attempt > 0) {
          onUpdate?.({
            stage: "submitted",
            message: `Retrying extrinsic with higher priority fee (tip=${tip})`
          })
        }

        return await submitWithTip(tx, ownerAddress, injector.signer, tip, onUpdate, api)
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error("Extrinsic submission failed")
        lastError = normalized

        if (!isLowPriorityTransactionError(normalized) || attempt === attemptTips.length - 1) {
          throw normalized
        }
      }
    }

    throw lastError ?? new Error("Extrinsic submission failed")
  } finally {
    await api.disconnect()
  }
}

function resolveBucketsTxMethod(
  buckets: Record<string, unknown> | undefined,
  candidateMethodNames: string[]
): ((namespaceId: unknown, bucketId: unknown, memberAddress: unknown) => unknown) | undefined {
  const method = resolveBucketsArbitraryTxMethod(buckets, candidateMethodNames)
  return method as ((namespaceId: unknown, bucketId: unknown, memberAddress: unknown) => unknown) | undefined
}

function resolveBucketsArbitraryTxMethod(
  buckets: Record<string, unknown> | undefined,
  candidateMethodNames: string[]
): ((...args: unknown[]) => unknown) | undefined {
  if (!buckets) {
    return undefined
  }

  for (const methodName of candidateMethodNames) {
    const candidate = buckets[methodName]
    if (typeof candidate === "function") {
      return candidate as (...args: unknown[]) => unknown
    }
  }

  const normalizedCandidates = new Set(candidateMethodNames.map((name) => normalizeMethodName(name)))
  for (const [methodName, candidate] of Object.entries(buckets)) {
    if (typeof candidate !== "function") {
      continue
    }

    if (normalizedCandidates.has(normalizeMethodName(methodName))) {
      return candidate as (...args: unknown[]) => unknown
    }
  }

  return undefined
}

function logEncodedCallBytes(callName: string, tx: SubmittableTx): void {
  const encoded = getEncodedCallBytes(tx)
  if (encoded) {
    console.log(`[Extrinsic] ${callName} call bytes: ${encoded}`)
    return
  }

  console.log(`[Extrinsic] ${callName} call bytes: unavailable`)
}

function getEncodedCallBytes(tx: SubmittableTx): `0x${string}` | undefined {
  const candidate = tx as unknown as ExtrinsicWithEncoding

  if (candidate.method && typeof candidate.method.toHex === "function") {
    const encoded = candidate.method.toHex()
    if (typeof encoded === "string" && /^0x[0-9a-fA-F]+$/.test(encoded)) {
      return encoded as `0x${string}`
    }
  }

  if (typeof candidate.toHex === "function") {
    const encoded = candidate.toHex()
    if (typeof encoded === "string" && /^0x[0-9a-fA-F]+$/.test(encoded)) {
      return encoded as `0x${string}`
    }
  }

  return undefined
}

function normalizeMethodName(value: string): string {
  return value.replace(/[_-]/g, "").toLowerCase()
}

async function queryBucketsNamespacesStorage(endpoint: string): Promise<unknown[]> {
  const [{ ApiPromise, WsProvider }] = await Promise.all([import("@polkadot/api")])

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const buckets = (api.query as Record<string, unknown>).buckets as Record<string, unknown> | undefined
    const namespaces = buckets?.namespaces as { entries?: () => Promise<Array<[unknown, unknown]>> } | undefined

    if (!namespaces?.entries) {
      throw new Error("buckets.namespaces storage is not available on this chain")
    }

    const entries = await namespaces.entries()
    return entries.map(([storageKey, value], index) => {
      const namespaceId = extractNamespaceId(storageKey, index)
      const valueData = normalizeCodecValue(value)

      if (valueData && typeof valueData === "object" && !Array.isArray(valueData)) {
        return {
          id: namespaceId,
          ...(valueData as Record<string, unknown>)
        }
      }

      return {
        id: namespaceId,
        value: valueData
      }
    })
  } finally {
    await api.disconnect()
  }
}

async function queryBucketsStorage(endpoint: string): Promise<unknown[]> {
  const [{ ApiPromise, WsProvider }] = await Promise.all([import("@polkadot/api")])

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const bucketsQuery = (api.query as Record<string, unknown>).buckets as Record<string, unknown> | undefined
    const bucketsStorage = bucketsQuery?.buckets as { entries?: () => Promise<Array<[unknown, unknown]>> } | undefined

    if (!bucketsStorage?.entries) {
      throw new Error("buckets.buckets storage is not available on this chain")
    }

    const entries = await bucketsStorage.entries()
    return entries.map(([storageKey, value], index) => {
      const keyArgs = extractStorageKeyArgs(storageKey)
      const bucketId = keyArgs.length > 0 ? keyArgs[keyArgs.length - 1]! : `bucket-${index + 1}`
      const namespaceId = keyArgs.length > 1 ? keyArgs[0] : undefined
      const valueData = normalizeCodecValue(value)

      if (valueData && typeof valueData === "object" && !Array.isArray(valueData)) {
        const valueObject = valueData as Record<string, unknown>
        return {
          id: bucketId,
          namespaceId,
          ...valueObject
        }
      }

      return {
        id: bucketId,
        namespaceId,
        value: valueData
      }
    })
  } finally {
    await api.disconnect()
  }
}

async function queryBucketsMessagesStorage(endpoint: string): Promise<unknown[]> {
  const [{ ApiPromise, WsProvider }] = await Promise.all([import("@polkadot/api")])

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const bucketsQuery = (api.query as Record<string, unknown>).buckets as Record<string, unknown> | undefined
    const messagesStorage = bucketsQuery?.messages as { entries?: () => Promise<Array<[unknown, unknown]>> } | undefined

    if (!messagesStorage?.entries) {
      throw new Error("buckets.messages storage is not available on this chain")
    }

    const entries = await messagesStorage.entries()
    return entries.map(([storageKey, value], index) => {
      const keyArgs = extractStorageKeyArgs(storageKey)
      const messageId = keyArgs.length > 0 ? keyArgs[keyArgs.length - 1]! : `message-${index + 1}`
      const bucketId = keyArgs.length > 1 ? keyArgs[0] : undefined
      const valueData = normalizeCodecValue(value)

      if (valueData && typeof valueData === "object" && !Array.isArray(valueData)) {
        const valueObject = valueData as Record<string, unknown>
        return {
          id: messageId,
          bucketId,
          ...valueObject
        }
      }

      return {
        id: messageId,
        bucketId,
        value: valueData
      }
    })
  } finally {
    await api.disconnect()
  }
}

async function queryBucketMemberAddressesStorage(
  endpoint: string,
  storageCandidates: string[],
  bucketId: string
): Promise<string[]> {
  const [{ ApiPromise, WsProvider }] = await Promise.all([import("@polkadot/api")])

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const bucketsQuery = (api.query as Record<string, unknown>).buckets as Record<string, unknown> | undefined
    const memberStorage = resolveBucketsQueryStorage(bucketsQuery, storageCandidates)

    if (!memberStorage?.entries) {
      throw new Error(`buckets.${storageCandidates[0]} storage is not available on this chain`)
    }

    const entriesFn = memberStorage.entries
    if (!entriesFn) {
      throw new Error(`buckets.${storageCandidates[0]} storage is not available on this chain`)
    }

    const targetBucketId = normalizeComparableId(bucketId)
    const entries = await queryBucketMemberEntries(entriesFn, bucketId)

    const addresses = entries
      .map(([storageKey]) => extractStorageKeyArgs(storageKey))
      .flatMap((args) => {
        if (args.length === 0) {
          return []
        }

        if (args.length === 1) {
          return [args[0]!]
        }

        if (normalizeComparableId(args[0]) === targetBucketId) {
          return [args[args.length - 1]!]
        }

        return []
      })
      .map((address) => address.trim().replace(/^"|"$/g, ""))
      .filter((address) => address.length > 0)

    return Array.from(new Set(addresses))
  } finally {
    await api.disconnect()
  }
}

async function queryBucketMemberEntries(
  entriesFn: (...args: unknown[]) => Promise<Array<[unknown, unknown]>>,
  bucketId: string
): Promise<Array<[unknown, unknown]>> {
  try {
    return await entriesFn(bucketId)
  } catch {
    return await entriesFn()
  }
}

function resolveBucketsQueryStorage(
  bucketsQuery: Record<string, unknown> | undefined,
  candidateNames: string[]
): { entries?: (...args: unknown[]) => Promise<Array<[unknown, unknown]>> } | undefined {
  if (!bucketsQuery) {
    return undefined
  }

  for (const name of candidateNames) {
    const candidate = bucketsQuery[name]
    if (candidate && (typeof candidate === "object" || typeof candidate === "function")) {
      return candidate as { entries?: (...args: unknown[]) => Promise<Array<[unknown, unknown]>> }
    }
  }

  return undefined
}

function extractNamespaceId(storageKey: unknown, index: number): string {
  if (storageKey && typeof storageKey === "object" && "args" in storageKey) {
    const args = (storageKey as { args?: unknown[] }).args
    if (Array.isArray(args) && args.length > 0) {
      const firstArg = args[0]
      if (firstArg !== undefined && firstArg !== null) {
        return stringifyCodecValue(firstArg) || `namespace-${index + 1}`
      }
    }
  }

  return `namespace-${index + 1}`
}

function extractStorageKeyArgs(storageKey: unknown): string[] {
  if (!storageKey || typeof storageKey !== "object" || !("args" in storageKey)) {
    return []
  }

  const args = (storageKey as { args?: unknown[] }).args
  if (!Array.isArray(args)) {
    return []
  }

  return args
    .map((value) => stringifyCodecValue(value))
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function normalizeComparableId(value: unknown): string {
  return stringifyCodecValue(value).trim().replace(/^"|"$/g, "").toLowerCase()
}

async function resolveNamespaceIdForBucketWrite(
  api: { query?: unknown },
  bucketId: string
): Promise<string> {
  const bucketsQuery = (api.query as Record<string, unknown> | undefined)?.buckets as Record<string, unknown> | undefined
  const bucketsStorage = bucketsQuery?.buckets as { entries?: () => Promise<Array<[unknown, unknown]>> } | undefined

  if (!bucketsStorage?.entries) {
    throw new Error("buckets.buckets storage is not available on this chain")
  }

  const targetBucketId = normalizeComparableId(bucketId)
  const entries = await bucketsStorage.entries()

  for (const [storageKey, value] of entries) {
    const keyArgs = extractStorageKeyArgs(storageKey)
    const keyMatched = keyArgs.length > 0 && normalizeComparableId(keyArgs[keyArgs.length - 1]) === targetBucketId

    if (keyMatched && keyArgs.length > 1) {
      return keyArgs[0]!
    }

    const normalized = normalizeCodecValue(value)
    if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
      const valueRecord = normalized as Record<string, unknown>
      const candidateBucketId = valueRecord.id ?? valueRecord.bucketId
      if (normalizeComparableId(candidateBucketId) === targetBucketId) {
        const namespaceCandidate = valueRecord.namespaceId ?? valueRecord.namespace
        const namespaceId = stringifyCodecValue(namespaceCandidate).trim()
        if (namespaceId) {
          return namespaceId
        }
      }
    }
  }

  throw new Error(`Unable to resolve namespace id for bucket ${bucketId} required by buckets.write`)
}

async function buildBucketsWriteMessageInput(referenceCid: string, message: string, tag?: string, contentTypeOverride?: string): Promise<{
  reference: `0x${string}`
  tag: `0x${string}` | null
  metadataInput: {
    description: `0x${string}`
    contentType: `0x${string}`
    contentHash: `0x${string}`
    properties: Record<string, unknown>
  }
}> {
  const normalizedReferenceCid = referenceCid.trim()
  if (!normalizedReferenceCid) {
    throw new Error("Reference CID is required for buckets.write")
  }

  const normalizedTag = typeof tag === "string" ? tag.trim() : ""
  const messageDigest = await sha256HexUtf8(message)
  const isDidCommKeySharing = normalizedTag === "didcomm/key-sharing-v1"

  const trimmedContentTypeOverride = typeof contentTypeOverride === "string" ? contentTypeOverride.trim() : ""
  const contentType = trimmedContentTypeOverride || (normalizedTag === "didcomm/key-sharing-v1"
    ? "application/didcomm-encrypted+json"
    : "text/plain;charset=utf-8")

  return {
    reference: utf8ToHexBytes(normalizedReferenceCid),
    tag: normalizedTag ? utf8ToHexBytes(normalizedTag) : null,
    metadataInput: {
      description: utf8ToHexBytes(""),
      contentType: utf8ToHexBytes(contentType),
      contentHash: messageDigest,
      properties: {}
    }
  }
}

async function sha256HexUtf8(input: string): Promise<`0x${string}`> {
  const bytes = new TextEncoder().encode(input)

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes)
    return bytesToHex(new Uint8Array(digest))
  }

  const { createHash } = await import("node:crypto")
  const hash = createHash("sha256").update(bytes).digest()
  return bytesToHex(Uint8Array.from(hash.values()))
}

function resolvePinataConfig(override?: PinataConfig): PinataConfig {
  const sanitizedOverride = sanitizePinataConfig(override)
  if (sanitizedOverride) {
    return sanitizedOverride
  }

  return {
    jwt: resolveRuntimeOrEnvValue("pinataJwt", "NUXT_PUBLIC_PINATA_JWT"),
    apiKey: resolveRuntimeOrEnvValue("pinataApiKey", "NUXT_PUBLIC_PINATA_API_KEY"),
    apiSecret: resolveRuntimeOrEnvValue("pinataApiSecret", "NUXT_PUBLIC_PINATA_API_SECRET"),
    publicGateway: resolveRuntimeOrEnvValue("pinataGateway", "NUXT_PUBLIC_PINATA_GATEWAY")
  }
}

function resolveRuntimeOrEnvValue(runtimeKey: string, envKey: string): string | undefined {
  const runtimePublic = (globalThis as unknown as {
    __NUXT__?: { config?: { public?: Record<string, unknown> } }
  }).__NUXT__?.config?.public

  const runtimeValue = runtimePublic?.[runtimeKey]
  if (typeof runtimeValue === "string" && runtimeValue.trim()) {
    return runtimeValue.trim()
  }

  const runtimeEnvValue = runtimePublic?.[envKey]
  if (typeof runtimeEnvValue === "string" && runtimeEnvValue.trim()) {
    return runtimeEnvValue.trim()
  }

  const processEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env
  const fromProcess = processEnv?.[envKey]
  if (fromProcess && fromProcess.trim()) {
    return fromProcess.trim()
  }

  const importMetaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  const fromImportMeta = importMetaEnv?.[envKey]
  if (fromImportMeta && fromImportMeta.trim()) {
    return fromImportMeta.trim()
  }

  return undefined
}

function sanitizePinataConfig(config?: PinataConfig): PinataConfig | undefined {
  if (!config) {
    return undefined
  }

  const sanitized: PinataConfig = {}
  if (typeof config.jwt === "string" && config.jwt.trim()) {
    sanitized.jwt = config.jwt.trim()
  }
  if (typeof config.apiKey === "string" && config.apiKey.trim()) {
    sanitized.apiKey = config.apiKey.trim()
  }
  if (typeof config.apiSecret === "string" && config.apiSecret.trim()) {
    sanitized.apiSecret = config.apiSecret.trim()
  }
  if (typeof config.publicGateway === "string" && config.publicGateway.trim()) {
    sanitized.publicGateway = config.publicGateway.trim()
  }

  return Object.keys(sanitized).length ? sanitized : undefined
}

function normalizeCodecValue(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value
  }

  const codec = value as {
    toJSON?: () => unknown
    toHuman?: () => unknown
    toString?: () => string
  }

  if (typeof codec.toJSON === "function") {
    const json = codec.toJSON()
    if (json !== undefined) {
      return json
    }
  }

  if (typeof codec.toHuman === "function") {
    const human = codec.toHuman()
    if (human !== undefined) {
      return human
    }
  }

  if (typeof codec.toString === "function") {
    return codec.toString()
  }

  return value
}

function stringifyCodecValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  const normalized = normalizeCodecValue(value)
  if (typeof normalized === "string" || typeof normalized === "number" || typeof normalized === "boolean") {
    return String(normalized)
  }

  try {
    return JSON.stringify(normalized)
  } catch {
    return String(value)
  }
}

async function submitWithTip(
  tx: SubmittableTx,
  ownerAddress: string,
  signer: unknown,
  tip: string,
  onUpdate: ExtrinsicUpdateHandler | undefined,
  api: { registry?: { findMetaError?: unknown } }
): Promise<string> {
  if (!onUpdate) {
    const txHash = await submitWithoutWatch(tx, ownerAddress, signer, tip)
    return txHash
  }

  try {
    return await submitWithWatch(tx, ownerAddress, signer, tip, onUpdate, api)
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error("Extrinsic submission failed")

    if (!isSubscriptionRateLimitError(normalized)) {
      throw normalized
    }

    onUpdate({
      stage: "submitted",
      message: "Node subscription limit reached, continuing without live status updates"
    })

    return await submitWithoutWatch(tx, ownerAddress, signer, tip)
  }
}

async function submitWithoutWatch(
  tx: SubmittableTx,
  ownerAddress: string,
  signer: unknown,
  tip: string
): Promise<string> {
  const result = await tx.signAndSend(ownerAddress, { signer, tip })
  return extractHash(result) ?? `submitted-${Date.now()}`
}

async function submitWithWatch(
  tx: SubmittableTx,
  ownerAddress: string,
  signer: unknown,
  tip: string,
  onUpdate: ExtrinsicUpdateHandler,
  api: { registry?: { findMetaError?: unknown } }
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let unsubscribe: (() => void) | undefined
    let unsubscribeRequestedBeforeReady = false
    let resolved = false
    const fallbackHash = `submitted-${Date.now()}`
    let latestHash = fallbackHash

    const clean = () => {
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = undefined
      } else {
        unsubscribeRequestedBeforeReady = true
      }
    }

    tx.signAndSend(ownerAddress, { signer, tip }, (result) => {
      const status = result.status as Record<string, unknown> | undefined
      const txHashValue = extractHash(result.txHash)
      if (txHashValue) {
        latestHash = txHashValue
      }

      if (status?.isReady) {
        onUpdate?.({
          stage: "submitted",
          message: "Extrinsic accepted by node",
          txHash: latestHash
        })
      }

      if (status?.isBroadcast) {
        onUpdate?.({
          stage: "broadcast",
          message: "Extrinsic broadcast to peers",
          txHash: latestHash
        })
      }

      if (status?.isInBlock && !resolved) {
        const blockHash = extractHash(status.asInBlock)
        onUpdate?.({
          stage: "inBlock",
          message: "Extrinsic included in block",
          txHash: latestHash,
          blockHash
        })
        resolved = true
        clean()
        resolve(latestHash)
      }

      if (status?.isFinalized) {
        const blockHash = extractHash(status.asFinalized)
        onUpdate?.({
          stage: "finalized",
          message: "Extrinsic finalized on chain",
          txHash: latestHash,
          blockHash
        })
      }

      const dispatchError = result.dispatchError as Record<string, unknown> | undefined
      if (dispatchError && !resolved) {
        const message = formatDispatchError(dispatchError, api)
        onUpdate?.({
          stage: "error",
          message,
          txHash: latestHash
        })
        resolved = true
        clean()
        reject(new Error(message))
      }
    }).then((value) => {
      if (typeof value === "function") {
        unsubscribe = value
        if (unsubscribeRequestedBeforeReady) {
          unsubscribe()
          unsubscribe = undefined
        }
        return
      }

      if (!resolved) {
        resolved = true
        clean()
        resolve(extractHash(value) ?? latestHash)
      }
    }).catch((error) => {
      if (!resolved) {
        resolved = true
        clean()
        reject(error)
      }
    })
  })
}

function isSubscriptionRateLimitError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return (
    message.includes("subscription rate limit") ||
    message.includes("rate limit exceeded") ||
    (message.includes("1008") && message.includes("subscription"))
  )
}

function isLowPriorityTransactionError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return message.includes("priority is too low") || message.includes("too low priority")
}

function extractHash(input: unknown): string | undefined {
  if (typeof input === "string") {
    return input
  }

  if (input && typeof input === "object" && "toHex" in input) {
    const toHex = (input as { toHex?: unknown }).toHex
    if (typeof toHex === "function") {
      return (toHex as () => string)()
    }
  }

  return undefined
}

function formatDispatchError(dispatchError: Record<string, unknown>, api: { registry?: { findMetaError?: unknown } }): string {
  const findMetaError = api.registry?.findMetaError
  const moduleError = extractModuleDispatchError(dispatchError)
  const decoded = decodeModuleMetadataError(moduleError, findMetaError)
  if (decoded) {
    return `${decoded.section}.${decoded.name}: ${decoded.docs.join(" ")}`
  }

  const fallback = dispatchError.toString?.()
  if (typeof fallback === "string" && fallback.trim()) {
    const parsed = tryParseJsonRecord(fallback)
    if (parsed) {
      const parsedModule = extractModuleDispatchError(parsed)
      const parsedDecoded = decodeModuleMetadataError(parsedModule, findMetaError)
      if (parsedDecoded) {
        return `${parsedDecoded.section}.${parsedDecoded.name}: ${parsedDecoded.docs.join(" ")}`
      }
    }

    return fallback
  }

  return "Extrinsic failed"
}

function extractModuleDispatchError(dispatchError: Record<string, unknown>): unknown {
  if (dispatchError.isModule && "asModule" in dispatchError) {
    return dispatchError.asModule
  }

  if ("module" in dispatchError && dispatchError.module) {
    return dispatchError.module
  }

  if ("Module" in dispatchError && dispatchError.Module) {
    return dispatchError.Module
  }

  const toJSON = dispatchError.toJSON
  if (typeof toJSON === "function") {
    try {
      const encoded = (toJSON as () => unknown)()
      if (encoded && typeof encoded === "object") {
        const value = encoded as Record<string, unknown>
        if ("module" in value && value.module) {
          return value.module
        }
        if ("Module" in value && value.Module) {
          return value.Module
        }
      }
    } catch {
      return undefined
    }
  }

  return undefined
}

function decodeModuleMetadataError(
  moduleError: unknown,
  findMetaError: unknown
): { section: string; name: string; docs: string[] } | undefined {
  if (!moduleError || typeof findMetaError !== "function") {
    return undefined
  }

  const decoder = findMetaError as (value: unknown) => { section: string; name: string; docs: string[] }

  try {
    return decoder(moduleError)
  } catch {
    const normalized = normalizeModuleErrorValue(moduleError)
    if (!normalized) {
      return undefined
    }

    try {
      return decoder(normalized)
    } catch {
      return undefined
    }
  }
}

function normalizeModuleErrorValue(value: unknown): { index: number; error: Uint8Array } | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  const index = normalizeModuleIndex(candidate.index)
  const error = normalizeModuleErrorBytes(candidate.error)
  if (index === undefined || !error) {
    return undefined
  }

  return { index, error }
}

function normalizeModuleIndex(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed
    }
  }

  return undefined
}

function normalizeModuleErrorBytes(value: unknown): Uint8Array | undefined {
  if (value && typeof value === "object" && "toU8a" in value) {
    const toU8a = (value as { toU8a?: unknown }).toU8a
    if (typeof toU8a === "function") {
      try {
        const converted = (toU8a as () => unknown)()
        const normalized = coerceToU8a(converted)
        if (normalized) {
          return normalized
        }
      } catch {
      }
    }
  }

  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) {
    const hex = value.slice(2)
    if (hex.length % 2 !== 0) {
      return undefined
    }

    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
    }
    return bytes
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) {
    return new Uint8Array([value, 0, 0, 0])
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "number" && item >= 0 && item <= 255)) {
    return Uint8Array.from(value)
  }

  const coerced = coerceToU8a(value)
  if (coerced) {
    return coerced
  }

  if (value && typeof value === "object") {
    const toString = (value as { toString?: unknown }).toString
    if (typeof toString === "function") {
      try {
        const serialized = (toString as () => string)()
        const fromSerialized = normalizeModuleErrorBytes(serialized)
        if (fromSerialized) {
          return fromSerialized
        }
      } catch {
      }
    }
  }

  return undefined
}

function coerceToU8a(value: unknown): Uint8Array | undefined {
  if (!value) {
    return undefined
  }

  if (value instanceof Uint8Array) {
    return value
  }

  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "number" && item >= 0 && item <= 255)) {
    return Uint8Array.from(value)
  }

  return undefined
}

function tryParseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
  }

  return undefined
}

function utf8ToHexBytes(input: string): `0x${string}` {
  const bytes = new TextEncoder().encode(input)
  let hex = ""

  for (const value of bytes) {
    hex += value.toString(16).padStart(2, "0")
  }

  return `0x${hex}`
}

function normalizeFixed32ByteKey(input: string): `0x${string}` {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error("New encryption key is required")
  }

  const fromHex = tryParseHexBytes(trimmed)
  if (fromHex) {
    if (fromHex.length !== 32) {
      throw new Error(`Expected input with 32 bytes (256 bits), found ${fromHex.length} bytes`)
    }
    return bytesToHex(fromHex)
  }

  const fromBase64Url = tryDecodeBase64Url(trimmed)
  if (fromBase64Url) {
    if (fromBase64Url.length !== 32) {
      throw new Error(`Expected input with 32 bytes (256 bits), found ${fromBase64Url.length} bytes`)
    }
    return bytesToHex(fromBase64Url)
  }

  const fromUtf8 = new TextEncoder().encode(trimmed)
  if (fromUtf8.length === 32) {
    return bytesToHex(fromUtf8)
  }

  throw new Error(`Expected input with 32 bytes (256 bits), found ${fromUtf8.length} bytes`)
}

function tryParseHexBytes(value: string): Uint8Array | undefined {
  if (!/^0x[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    return undefined
  }

  const payload = value.slice(2)
  const bytes = new Uint8Array(payload.length / 2)
  for (let index = 0; index < payload.length; index += 2) {
    bytes[index / 2] = Number.parseInt(payload.slice(index, index + 2), 16)
  }
  return bytes
}

function tryDecodeBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return undefined
  }

  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const paddingLength = (4 - (base64.length % 4)) % 4
  const padded = `${base64}${"=".repeat(paddingLength)}`

  try {
    if (typeof atob === "function") {
      const binary = atob(padded)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      return bytes
    }

    const globalWithBuffer = globalThis as unknown as {
      Buffer?: { from(input: string, encoding: string): { values(): Iterable<number> } }
    }
    if (globalWithBuffer.Buffer) {
      const buffer = globalWithBuffer.Buffer.from(padded, "base64")
      return Uint8Array.from(buffer.values())
    }
  } catch {
    return undefined
  }

  return undefined
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = ""
  for (const value of bytes) {
    hex += value.toString(16).padStart(2, "0")
  }
  return `0x${hex}`
}

function decodeUtf8HexStringIfPresent(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  if (!/^0x[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    return undefined
  }

  try {
    const hexPayload = value.slice(2)
    const bytes = new Uint8Array(hexPayload.length / 2)

    for (let i = 0; i < hexPayload.length; i += 2) {
      bytes[i / 2] = Number.parseInt(hexPayload.slice(i, i + 2), 16)
    }

    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}
