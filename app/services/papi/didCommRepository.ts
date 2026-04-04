import { PapiClient } from "./client"

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
  onUpdate?: ExtrinsicUpdateHandler
) => Promise<string>

type MessageExtrinsicSubmitter = (
  endpoint: string,
  bucketId: string,
  message: string,
  ownerAddress: string,
  onUpdate?: ExtrinsicUpdateHandler
) => Promise<string>

type NamespaceStorageReader = (endpoint: string) => Promise<unknown>
type BucketsStorageReader = (endpoint: string) => Promise<unknown>
type MessagesStorageReader = (endpoint: string) => Promise<unknown>

type SubmittableTx = {
  signAndSend(address: string, options: { signer: unknown; tip?: string }): Promise<{ toHex: () => string } | string>
  signAndSend(
    address: string,
    options: { signer: unknown; tip?: string },
    callback: (result: Record<string, unknown>) => void
  ): Promise<(() => void) | { toHex: () => string } | string>
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

export class DidCommRepository {
  private client: PapiRpcClient
  private submitExtrinsic: ExtrinsicSubmitter
  private submitBucketExtrinsic: BucketExtrinsicSubmitter
  private submitMessageExtrinsic: MessageExtrinsicSubmitter
  private readNamespaceStorage: NamespaceStorageReader
  private readBucketsStorage: BucketsStorageReader
  private readMessagesStorage: MessagesStorageReader

  constructor(
    client: PapiRpcClient = new PapiClient(),
    submitExtrinsic: ExtrinsicSubmitter = submitBucketsCreateNamespaceExtrinsic,
    submitBucketExtrinsic: BucketExtrinsicSubmitter = submitBucketsCreateBucketExtrinsic,
    readNamespaceStorage: NamespaceStorageReader = queryBucketsNamespacesStorage,
    readBucketsStorage: BucketsStorageReader = queryBucketsStorage,
    readMessagesStorage: MessagesStorageReader = queryBucketsMessagesStorage,
    submitMessageExtrinsic: MessageExtrinsicSubmitter = submitBucketsAddMessageExtrinsic
  ) {
    this.client = client
    this.submitExtrinsic = submitExtrinsic
    this.submitBucketExtrinsic = submitBucketExtrinsic
    this.submitMessageExtrinsic = submitMessageExtrinsic
    this.readNamespaceStorage = readNamespaceStorage
    this.readBucketsStorage = readBucketsStorage
    this.readMessagesStorage = readMessagesStorage
  }

  async fetchNamespaces(): Promise<BucketNamespace[]> {
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

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for buckets.messages storage query")
    }

    const response = await this.readMessagesStorage(endpoint)
    return this.normalizeMessages(response, trimmedBucketId)
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

  async setBucketPublicKey(_namespaceId: string, _bucketId: string, _numericKeyId: string): Promise<string> {
    return `tx-${Date.now()}-set-key`
  }

  async createTag(_bucketId: string, _tag: string): Promise<string> {
    return `tx-${Date.now()}-create-tag`
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
    onUpdate?: ExtrinsicUpdateHandler
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

    const txHash = await this.submitBucketExtrinsic(endpoint, trimmedNamespaceId, trimmedBucketName, ownerAddress, onUpdate)
    return {
      txHash,
      method: "buckets.createBucket"
    }
  }

  async createMessage(
    bucketId: string,
    message: string,
    ownerAddress?: string,
    onUpdate?: ExtrinsicUpdateHandler
  ): Promise<CreateMessageResult> {
    const trimmedBucketId = bucketId.trim()
    if (!trimmedBucketId) {
      throw new Error("Bucket id is required")
    }

    const trimmedMessage = message.trim()
    if (!trimmedMessage) {
      throw new Error("Message is required")
    }

    if (!ownerAddress) {
      throw new Error("Wallet must be connected to submit buckets.addMessage extrinsic")
    }

    const endpoint = this.client.getEndpoint?.()
    if (!endpoint) {
      throw new Error("Unable to resolve chain endpoint for extrinsic submission")
    }

    const txHash = await this.submitMessageExtrinsic(endpoint, trimmedBucketId, trimmedMessage, ownerAddress, onUpdate)
    return {
      txHash,
      method: "buckets.addMessage"
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
      schemaUri: null,
      properties: {}
    }

    const tx = createNamespace(metadataInput) as SubmittableTx

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
    const createBucket = buckets?.createBucket as ((namespace: unknown, metadata: unknown) => unknown) | undefined

    if (!createBucket) {
      throw new Error("buckets.createBucket extrinsic is not available on this chain")
    }

    const injector = await web3FromAddress(ownerAddress)
    const metadataInput = {
      name: utf8ToHexBytes(bucketName),
      schemaUri: null,
      properties: {}
    }

    const tx = createBucket(namespaceId, metadataInput) as SubmittableTx

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
    const addMessage = buckets?.addMessage as ((bucket: unknown, payload: unknown) => unknown) | undefined

    if (!addMessage) {
      throw new Error("buckets.addMessage extrinsic is not available on this chain")
    }

    const injector = await web3FromAddress(ownerAddress)
    const tx = addMessage(bucketId, utf8ToHexBytes(message)) as SubmittableTx

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

      if (status?.isInBlock) {
        const blockHash = extractHash(status.asInBlock)
        onUpdate?.({
          stage: "inBlock",
          message: "Extrinsic included in block",
          txHash: latestHash,
          blockHash
        })
      }

      if (status?.isFinalized && !resolved) {
        const blockHash = extractHash(status.asFinalized)
        onUpdate?.({
          stage: "finalized",
          message: "Extrinsic finalized on chain",
          txHash: latestHash,
          blockHash
        })
        resolved = true
        clean()
        resolve(latestHash)
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
  const isModule = Boolean(dispatchError.isModule)
  if (!isModule) {
    return String(dispatchError.toString?.() ?? "Extrinsic failed")
  }

  const asModule = dispatchError.asModule as Record<string, unknown> | undefined
  const findMetaError = api.registry?.findMetaError
  if (!asModule || typeof findMetaError !== "function") {
    return String(dispatchError.toString?.() ?? "Extrinsic failed")
  }

  try {
    const decoded = (findMetaError as (value: unknown) => { section: string; name: string; docs: string[] })(asModule)
    return `${decoded.section}.${decoded.name}: ${decoded.docs.join(" ")}`
  } catch {
    return String(dispatchError.toString?.() ?? "Extrinsic failed")
  }
}

function utf8ToHexBytes(input: string): `0x${string}` {
  const bytes = new TextEncoder().encode(input)
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
