<script setup lang="ts">
import { DidCommRepository, type BucketMessage, type BucketRecord, type ExtrinsicUpdate } from "../../../services/papi/didCommRepository"
import LoadingBar from "../../../components/common/LoadingBar.vue"
import { useAddress } from "../../../composables/useAddress"
import { Trash2 } from "lucide-vue-next"
import { hexToU8a } from "@polkadot/util"
import * as jose from "jose"
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { useNuxtApp, useRoute, useRuntimeConfig } from "nuxt/app"
import { useOperationsStore } from "../../../stores/operations"
import { useSessionStore } from "../../../stores/session"

const route = useRoute()
const { $papiClient } = useNuxtApp()
const runtimeConfig = useRuntimeConfig()
const session = useSessionStore()
const operations = useOperationsStore()
const { formatAddress, addressesEqual } = useAddress()

const asOptionalString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

const didCommRepository = new DidCommRepository(
  $papiClient as { rpc(method: string, params?: unknown[]): Promise<unknown>; getEndpoint?(): string },
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  {
    jwt: asOptionalString(runtimeConfig.public.pinataJwt),
    apiKey: asOptionalString(runtimeConfig.public.pinataApiKey),
    apiSecret: asOptionalString(runtimeConfig.public.pinataApiSecret),
    publicGateway: asOptionalString(runtimeConfig.public.pinataGateway)
  }
)

type DeliveryState = "sending" | "sent" | "failed"

interface PendingChatMessage {
  id: string
  body: string
  createdAt: Date
  sender?: string
  deliveryState: DeliveryState
}

interface ChatMessage {
  id: string
  body: string
  createdAt: Date
  outgoing: boolean
  senderLabel: string
  deliveryState?: DeliveryState
}

interface MetadataEntry {
  key: string
  value: string
}

interface WasmCompatibleSecretKey {
  kty: string
  crv: string
  x: string
  d: string
  y: string
  use: string
  kid: string
}

const bucketId = computed(() => {
  const rawId = route.params.id
  const value = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "")

  try {
    return decodeURIComponent(String(value))
  } catch {
    return String(value)
  }
})

const messages = ref<BucketMessage[]>([])
const messagesLoading = ref(false)
const messagesError = ref("")
const bucket = ref<BucketRecord | null>(null)
const bucketLoading = ref(false)
const bucketError = ref("")
const membersError = ref("")
const sendText = ref("")
const sendError = ref("")
const sending = ref(false)
const pendingMessages = ref<PendingChatMessage[]>([])
const chatViewport = ref<HTMLElement | null>(null)
const bucketAdmins = ref<string[]>([])
const bucketContributors = ref<string[]>([])
const removingAdminAddress = ref("")
const removingContributorAddress = ref("")
const loadingContributorKeys = ref(false)
const contributorX25519Keys = ref<Record<string, string>>({})
const currentBucketCall = ref("buckets.write")
const generatingEncryptionKey = ref(false)
const encryptionKeyError = ref("")
const encryptionKeySuccess = ref("")
const latestGeneratedKeyId = ref("")
const latestGeneratedPublicJwk = ref("")
const bucketDisplayName = computed(() => bucket.value?.name || bucketId.value)
const keySharingTag = "didcomm/key-sharing-v1"

const connectedAdmin = computed(() => {
  if (!session.accountAddress) {
    return false
  }

  return bucketAdmins.value.some((adminAddress) => addressesEqual(adminAddress, session.accountAddress as string))
})

const contributorRecipients = computed(() => {
  return bucketContributors.value.flatMap((address) => {
    const x25519 = contributorX25519Keys.value[address]
    if (!isValidX25519(x25519)) {
      return []
    }

    return [{ address, x25519: x25519.trim() }]
  })
})

const contributorsMissingEncryptionKey = computed(() => {
  return Math.max(0, bucketContributors.value.length - contributorRecipients.value.length)
})

const bucketMetadata = computed<MetadataEntry[]>(() => extractBucketMetadataEntries(bucket.value))

const chatMessages = computed<ChatMessage[]>(() => {
  const chainMessages = messages.value.map((message) => toChatMessage(message))
  const pending = pendingMessages.value.map((message) => ({
    id: message.id,
    body: message.body,
    createdAt: message.createdAt,
    outgoing: true,
    senderLabel: "You",
    deliveryState: message.deliveryState
  }))

  return [...chainMessages, ...pending].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
})

async function loadMessages() {
  messagesError.value = ""
  messagesLoading.value = true

  try {
    messages.value = await didCommRepository.fetchMessages(bucketId.value)
  } catch (error) {
    messagesError.value = error instanceof Error ? error.message : "Unable to load messages"
  } finally {
    messagesLoading.value = false
  }
}

async function loadBucket() {
  bucketError.value = ""
  bucketLoading.value = true

  try {
    const record = await didCommRepository.fetchBucket(bucketId.value)
    if (!record) {
      bucket.value = null
      bucketError.value = "Unable to find bucket metadata"
      return
    }

    bucket.value = record
  } catch (error) {
    bucket.value = null
    bucketError.value = error instanceof Error ? error.message : "Unable to load bucket metadata"
  } finally {
    bucketLoading.value = false
  }
}

async function loadBucketMembers() {
  membersError.value = ""

  try {
    const [admins, contributors] = await Promise.all([
      didCommRepository.fetchBucketAdmins(bucketId.value),
      didCommRepository.fetchBucketContributors(bucketId.value)
    ])

    bucketAdmins.value = admins
    bucketContributors.value = contributors
    await loadContributorX25519Keys(contributors)
  } catch (error) {
    bucketAdmins.value = []
    bucketContributors.value = []
    contributorX25519Keys.value = {}
    membersError.value = error instanceof Error ? error.message : "Unable to load bucket member lists"
  }
}

function isHex32(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value)
}

function isValidX25519(value: string | undefined): value is string {
  if (typeof value !== "string") {
    return false
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }

  return trimmed !== "Not found"
}

function normalizeX25519Value(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  // Some chains return x25519 as hex; convert to JWK x (base64url)
  if (isHex32(trimmed)) {
    return jose.base64url.encode(hexToU8a(trimmed))
  }

  // If already base64url (as in did.publicKeys.publicEncryptionKey.x25519), keep as-is
  return trimmed
}

function extractX25519FromPublicKeyEntry(entry: unknown): string | undefined {
  const keyRecord = toRecord(toRecord(entry)?.key)
  const publicEncryptionKey = toRecord(keyRecord?.publicEncryptionKey)
  return normalizeX25519Value(publicEncryptionKey?.x25519)
}

function extractContributorX25519(payload: unknown): string | undefined {
  const record = toRecord(payload)
  if (!record) {
    return undefined
  }

  const publicKeys = toRecord(record.publicKeys)
  const keyAgreementKeys = Array.isArray(record.keyAgreementKeys)
    ? record.keyAgreementKeys.filter((value): value is string => typeof value === "string")
    : []

  // Canonical path for this runtime:
  // keyAgreementKeys[] -> publicKeys[keyId].key.publicEncryptionKey.x25519
  if (publicKeys && keyAgreementKeys.length) {
    for (const keyId of keyAgreementKeys) {
      const normalizedId = keyId.trim().toLowerCase()
      const matchedEntry = Object.entries(publicKeys).find(([mapKey]) => mapKey.trim().toLowerCase() === normalizedId)?.[1]
      const x25519 = extractX25519FromPublicKeyEntry(matchedEntry)
      if (x25519) {
        return x25519
      }
    }
  }

  // Fallback: any encryption key in publicKeys map
  if (publicKeys) {
    for (const entry of Object.values(publicKeys)) {
      const x25519 = extractX25519FromPublicKeyEntry(entry)
      if (x25519) {
        return x25519
      }
    }
  }

  return undefined
}

async function queryDidPayloadByAddress(address: string): Promise<unknown> {
  const endpoint = session.networkEndpoint || runtimeConfig.public.xcavateWsEndpoint || "wss://xcavate-paseo.api.onfinality.io/public-ws"
  const { ApiPromise, WsProvider } = await import("@polkadot/api")

  const provider = new WsProvider(endpoint)
  const api = await ApiPromise.create({ provider })

  try {
    const queryDid = api.query?.did?.did
    if (typeof queryDid !== "function") {
      return undefined
    }

    const result = await queryDid(address)

    try {
      if (typeof result.toJSON === "function") {
        return result.toJSON()
      }
    } catch {
    }

    try {
      if (typeof result.toHuman === "function") {
        return result.toHuman()
      }
    } catch {
    }

    return typeof result.toString === "function" ? result.toString() : undefined
  } finally {
    await api.disconnect().catch(() => undefined)
    provider.disconnect()
  }
}

async function loadContributorX25519Keys(addresses: string[]): Promise<void> {
  contributorX25519Keys.value = {}

  if (!addresses.length) {
    return
  }

  loadingContributorKeys.value = true
  const keysByAddress: Record<string, string> = {}

  try {
    for (const address of addresses) {
      const payload = await queryDidPayloadByAddress(address)
      keysByAddress[address] = extractContributorX25519(payload) ?? "Not found"
    }

    contributorX25519Keys.value = keysByAddress
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load contributor DID key agreements"
    membersError.value = message
    operations.add("did_read", bucketId.value, "error", message)
  } finally {
    loadingContributorKeys.value = false
  }
}

function resolveNamespaceIdFromBucket(bucketRecord: BucketRecord | null): string {
  if (!bucketRecord) {
    return ""
  }

  if (bucketRecord.namespaceId?.trim()) {
    return bucketRecord.namespaceId.trim()
  }

  const rawRecord = toRecord(bucketRecord.raw)
  const candidate = rawRecord?.namespaceId ?? rawRecord?.namespace
  return typeof candidate === "string" ? candidate.trim() : ""
}

async function removeAdmin(address: string): Promise<void> {
  membersError.value = ""

  if (!session.accountAddress) {
    membersError.value = "Connect wallet before submitting member removal extrinsics"
    return
  }

  const namespaceId = resolveNamespaceIdFromBucket(bucket.value)
  if (!namespaceId) {
    membersError.value = "Namespace id is required to remove bucket members"
    return
  }

  removingAdminAddress.value = address
  currentBucketCall.value = "buckets.removeAdmin"

  try {
    const result = await didCommRepository.removeBucketAdmin(
      namespaceId,
      bucketId.value,
      address,
      session.accountAddress,
      logExtrinsicUpdate
    )

    operations.add("bucket_write", result.method, "success", `Admin removed: ${result.txHash}`)
    await loadBucketMembers()
  } catch (error) {
    membersError.value = error instanceof Error ? error.message : "Unable to remove admin"
    operations.add("bucket_write", currentBucketCall.value, "error", membersError.value)
  } finally {
    removingAdminAddress.value = ""
  }
}

async function removeContributor(address: string): Promise<void> {
  membersError.value = ""

  if (!session.accountAddress) {
    membersError.value = "Connect wallet before submitting member removal extrinsics"
    return
  }

  const namespaceId = resolveNamespaceIdFromBucket(bucket.value)
  if (!namespaceId) {
    membersError.value = "Namespace id is required to remove bucket members"
    return
  }

  removingContributorAddress.value = address
  currentBucketCall.value = "buckets.removeContributor"

  try {
    const result = await didCommRepository.removeBucketContributor(
      namespaceId,
      bucketId.value,
      address,
      session.accountAddress,
      logExtrinsicUpdate
    )

    operations.add("bucket_write", result.method, "success", `Contributor removed: ${result.txHash}`)
    await loadBucketMembers()
  } catch (error) {
    membersError.value = error instanceof Error ? error.message : "Unable to remove contributor"
    operations.add("bucket_write", currentBucketCall.value, "error", membersError.value)
  } finally {
    removingContributorAddress.value = ""
  }
}

function randomNumericKeyId(): number {
  return Math.floor(Math.random() * 1_000_000_000_000)
}

function toWasmCompatibleSecretKey(secretJwk: jose.JWK): WasmCompatibleSecretKey {
  if (!secretJwk.kty || !secretJwk.crv || !secretJwk.x || !secretJwk.d || !secretJwk.use || !secretJwk.kid) {
    throw new Error("The new secret JWK is missing required properties, including 'kid'.")
  }

  return {
    kty: secretJwk.kty,
    crv: secretJwk.crv,
    x: secretJwk.x,
    d: secretJwk.d,
    y: "", // Workaround for rigid key-sharing consumers expecting y.
    use: secretJwk.use,
    kid: secretJwk.kid
  }
}

function buildKeySharingMessage(secretJwk: jose.JWK, readerAddresses: string[]): string {
  const adminAddress = session.accountAddress
  if (!adminAddress) {
    throw new Error("Admin wallet address is required")
  }

  const messageId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `key-share-${Date.now()}-${Math.random().toString(16).slice(2)}`

  return JSON.stringify({
    id: messageId,
    from: adminAddress,
    to: readerAddresses,
    keys: [toWasmCompatibleSecretKey(secretJwk)]
  })
}

function buildRecipientJwks(bucketPublicJwk: jose.JWK): { recipientJwks: jose.JWK[]; readerAddresses: string[] } {
  const readerAddresses = contributorRecipients.value.map((recipient) => recipient.address)

  if (!readerAddresses.length) {
    throw new Error("No valid contributor X25519 keys are available for key sharing")
  }

  const recipientJwks: jose.JWK[] = [bucketPublicJwk]
  for (const recipient of contributorRecipients.value) {
    recipientJwks.push({
      kty: "OKP",
      crv: "X25519",
      x: recipient.x25519,
      use: "enc",
      kid: recipient.address
    })
  }

  return { recipientJwks, readerAddresses }
}

async function encryptJweForMultipleRecipients(plaintextBytes: Uint8Array, recipientJwks: jose.JWK[]): Promise<jose.GeneralJWE> {
  const encryptor = new jose.GeneralEncrypt(plaintextBytes).setProtectedHeader({
    enc: "A256GCM",
    typ: keySharingTag
  })

  for (const recipientJwk of recipientJwks) {
    const recipientHeader: jose.JWEHeaderParameters = {
      alg: "ECDH-ES+A256KW"
    }
    if (typeof recipientJwk.kid === "string" && recipientJwk.kid.trim()) {
      recipientHeader.kid = recipientJwk.kid
    }

    encryptor.addRecipient(recipientJwk).setUnprotectedHeader(recipientHeader)
  }

  return await encryptor.encrypt()
}

async function generateAndShareEncryptionKey(): Promise<void> {
  encryptionKeyError.value = ""
  encryptionKeySuccess.value = ""

  if (!session.accountAddress) {
    encryptionKeyError.value = "Connect wallet before generating encryption keys"
    return
  }

  if (!connectedAdmin.value) {
    encryptionKeyError.value = "Only bucket admins can generate and distribute encryption keys"
    return
  }

  if (loadingContributorKeys.value) {
    encryptionKeyError.value = "Contributor X25519 keys are still loading"
    return
  }

  const namespaceId = resolveNamespaceIdFromBucket(bucket.value)
  if (!namespaceId) {
    encryptionKeyError.value = "Namespace id is required to rotate bucket encryption keys"
    return
  }

  generatingEncryptionKey.value = true
  console.groupCollapsed(`[Bucket Key Rotation] bucket=${bucketId.value}`)

  try {
    console.log("--- [ADMIN] 4a. Generating Bucket Keys ---")
    const { publicKey, privateKey } = await jose.generateKeyPair("ECDH-ES+A256KW", {
      crv: "X25519",
      extractable: true
    })

    const bucketPkJwk = await jose.exportJWK(publicKey)
    const bucketSkJwk = await jose.exportJWK(privateKey)

    const numericKeyId = randomNumericKeyId()
    const keyId = numericKeyId.toString()

    bucketPkJwk.use = "enc"
    bucketSkJwk.use = "enc"
    bucketPkJwk.kid = keyId
    bucketSkJwk.kid = keyId

    console.log("Generated bucketPkJwk:", bucketPkJwk)
    console.log("Generated bucketSkJwk:", bucketSkJwk)

    const bucketEncryptionKey = typeof bucketPkJwk.x === "string" ? bucketPkJwk.x.trim() : ""
    if (!bucketEncryptionKey) {
      throw new Error("Generated public key is missing JWK.x and cannot be used for on-chain key rotation")
    }

    console.log(`🔑 Bucket Public Key generated. keyId: ${numericKeyId}`)

    currentBucketCall.value = "buckets.resumeWriting"
    console.log("--- [ADMIN] 4b. Updating bucket encryption key on-chain (resumeWriting) ---")
    const setKeyTxHash = await didCommRepository.setBucketPublicKey(
      namespaceId,
      bucketId.value,
      bucketEncryptionKey,
      session.accountAddress,
      logExtrinsicUpdate
    )
    console.log(`✅ Bucket encryption key updated on-chain. Transaction Hash: ${setKeyTxHash}`)

    let tagTxHash = ""
    currentBucketCall.value = "buckets.createTag"
    console.log(`--- [ADMIN] 4c. Creating Tag \"${keySharingTag}\" for Bucket ${bucketId.value} ---`)
    try {
      tagTxHash = await didCommRepository.createTag(bucketId.value, keySharingTag, session.accountAddress, logExtrinsicUpdate)
      console.log(`✅ Tag created successfully. Transaction Hash: ${tagTxHash}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create key-sharing tag"
      if (message.toLowerCase().includes("already")) {
        console.warn(`⚠️ Tag likely already exists. Continuing. Details: ${message}`)
      } else {
        throw error
      }
    }

    console.log("--- [ADMIN] 4d. Preparing recipients and encrypting key-sharing payload ---")
    const { recipientJwks, readerAddresses } = buildRecipientJwks(bucketPkJwk)
    console.log(`Using ${readerAddresses.length} contributor reader(s):`, readerAddresses)

    const keySharingMessage = buildKeySharingMessage(bucketSkJwk, readerAddresses)
    console.log("Constructed Key-Sharing Message:", JSON.parse(keySharingMessage) as unknown)

    const plaintextBytes = new TextEncoder().encode(keySharingMessage)
    const jweObject = await encryptJweForMultipleRecipients(plaintextBytes, recipientJwks)
    const jweString = JSON.stringify(jweObject)
    console.log(`Encrypted key-sharing JWE length: ${jweString.length}`)
    console.log(`Encrypted key-sharing JWE: ${jweString}`)

    const jweDigestBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jweString))
    const jweDigest = Array.from(new Uint8Array(jweDigestBuffer)).map((value) => value.toString(16).padStart(2, "0")).join("")
    console.log(`Key-sharing JWE digest (sha256): 0x${jweDigest}`)
    console.log("Submitting DIDComm key-sharing payload directly in buckets.write messageInput.reference")

    console.log("--- [ADMIN] 4e. Submitting key-sharing payload to bucket messages ---")
    currentBucketCall.value = "buckets.write"
    const shareResult = await didCommRepository.createMessage(
      bucketId.value,
      jweString,
      session.accountAddress,
      logExtrinsicUpdate,
      keySharingTag
    )
    console.log(`✅ Bucket secret key shared successfully. Transaction Hash: ${shareResult.txHash}`)

    latestGeneratedKeyId.value = keyId
    latestGeneratedPublicJwk.value = JSON.stringify(bucketPkJwk, null, 2)
    encryptionKeySuccess.value = `New encryption key generated and shared. keyId=${keyId}`

    operations.add(
      "bucket_write",
      "buckets.write",
      "success",
      `Bucket key rotated and shared. keyId=${keyId}, tx=${shareResult.txHash}`
    )

    await loadMessages()
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to rotate bucket encryption key"
    encryptionKeyError.value = message
    operations.add("bucket_write", currentBucketCall.value, "error", message)
    console.error("❌ Error rotating bucket key", error)
  } finally {
    generatingEncryptionKey.value = false
    console.groupEnd()
  }
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function decodeHexToUtf8(value: string): string | undefined {
  if (!/^0x[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    return undefined
  }

  try {
    const payload = value.slice(2)
    const bytes = new Uint8Array(payload.length / 2)

    for (let index = 0; index < payload.length; index += 2) {
      bytes[index / 2] = Number.parseInt(payload.slice(index, index + 2), 16)
    }

    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  return decodeHexToUtf8(value) ?? value
}

function firstString(record: Record<string, unknown> | undefined, fields: string[]): string | undefined {
  if (!record) {
    return undefined
  }

  for (const field of fields) {
    const candidate = textValue(record[field])
    if (candidate && candidate.trim()) {
      return candidate.trim()
    }
  }

  return undefined
}

function toDate(value: unknown): Date | undefined {
  if (!value) {
    return undefined
  }

  if (typeof value === "number") {
    const normalized = value > 1_000_000_000_000 ? value : value * 1000
    const parsed = new Date(normalized)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }

  if (typeof value === "string") {
    const asNumber = Number(value)
    if (!Number.isNaN(asNumber) && value.trim()) {
      return toDate(asNumber)
    }

    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }

  return undefined
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === "string") {
    return textValue(value) ?? value
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }

  if (value === null) {
    return "null"
  }

  if (value === undefined) {
    return "undefined"
  }

  return JSON.stringify(value)
}

function appendMetadataEntries(entries: MetadataEntry[], key: string, value: unknown): void {
  if (value === undefined) {
    return
  }

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    entries.push({ key, value: formatMetadataValue(value) })
    return
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      entries.push({ key, value: "[]" })
      return
    }

    value.forEach((item, index) => {
      appendMetadataEntries(entries, `${key}[${index}]`, item)
    })
    return
  }

  const nestedRecord = toRecord(value)
  if (!nestedRecord) {
    entries.push({ key, value: formatMetadataValue(value) })
    return
  }

  const nestedEntries = Object.entries(nestedRecord)
  if (!nestedEntries.length) {
    entries.push({ key, value: "{}" })
    return
  }

  nestedEntries.forEach(([nestedKey, nestedValue]) => {
    appendMetadataEntries(entries, `${key}.${nestedKey}`, nestedValue)
  })
}

function extractBucketMetadataEntries(bucketRecord: BucketRecord | null): MetadataEntry[] {
  if (!bucketRecord) {
    return []
  }

  const rawRecord = toRecord(bucketRecord.raw)
  const source: Record<string, unknown> = rawRecord ? { ...rawRecord } : {}

  if (!("id" in source) && bucketRecord.id) {
    source.id = bucketRecord.id
  }

  if (!("name" in source) && bucketRecord.name) {
    source.name = bucketRecord.name
  }

  if (!("namespaceId" in source) && bucketRecord.namespaceId) {
    source.namespaceId = bucketRecord.namespaceId
  }

  const entries: MetadataEntry[] = []
  Object.entries(source).forEach(([key, value]) => {
    appendMetadataEntries(entries, key, value)
  })

  return entries
}

function toChatMessage(message: BucketMessage): ChatMessage {
  const rawRecord = toRecord(message.raw)
  const body =
    firstString(rawRecord, ["message", "content", "payload", "body", "text", "summary"]) ?? message.summary
  const sender = firstString(rawRecord, ["sender", "from", "author", "owner", "account"])
  const createdAt =
    toDate(rawRecord?.createdAt) ??
    toDate(rawRecord?.timestamp) ??
    toDate(rawRecord?.time) ??
    toDate(rawRecord?.submittedAt) ??
    new Date(0)

  const outgoing = Boolean(session.accountAddress && sender && addressesEqual(session.accountAddress, sender))

  return {
    id: message.id,
    body,
    createdAt,
    outgoing,
    senderLabel: outgoing ? "You" : sender ? formatAddress(sender) : "Unknown"
  }
}

async function loadBucketPage() {
  await Promise.all([loadBucket(), loadBucketMembers(), loadMessages()])
}

function formatTimestamp(value: Date): string {
  if (value.getTime() === 0) {
    return ""
  }

  return value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  })
}

function logExtrinsicUpdate(update: ExtrinsicUpdate): void {
  const details = [update.message]
  if (update.txHash) {
    details.push(`tx: ${update.txHash}`)
  }
  if (update.blockHash) {
    details.push(`block: ${update.blockHash}`)
  }

  operations.add(
    "bucket_write",
    `${currentBucketCall.value}:${update.stage}`,
    update.stage === "error" ? "error" : "info",
    details.join(" · ")
  )
}

async function sendMessage() {
  sendError.value = ""
  const payload = sendText.value.trim()

  if (!payload) {
    sendError.value = "Message content is required"
    return
  }

  if (!session.accountAddress) {
    sendError.value = "Connect wallet before sending messages"
    return
  }

  const pendingId = `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`
  pendingMessages.value.push({
    id: pendingId,
    body: payload,
    createdAt: new Date(),
    sender: session.accountAddress,
    deliveryState: "sending"
  })

  sendText.value = ""
  sending.value = true
  currentBucketCall.value = "buckets.write"

  try {
    const result = await didCommRepository.createMessage(bucketId.value, payload, session.accountAddress, logExtrinsicUpdate)
    const pending = pendingMessages.value.find((entry) => entry.id === pendingId)
    if (pending) {
      pending.deliveryState = "sent"
    }

    operations.add("bucket_write", result.method, "success", `Message submitted: ${result.txHash}`)
    await loadMessages()
    pendingMessages.value = pendingMessages.value.filter((entry) => entry.deliveryState === "failed")
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit message"
    sendError.value = message
    const pending = pendingMessages.value.find((entry) => entry.id === pendingId)
    if (pending) {
      pending.deliveryState = "failed"
    }

    operations.add("bucket_write", currentBucketCall.value, "error", message)
    if (!sendText.value) {
      sendText.value = payload
    }
  } finally {
    sending.value = false
  }
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  if (!chatViewport.value) {
    return
  }

  chatViewport.value.scrollTop = chatViewport.value.scrollHeight
}

watch(
  () => chatMessages.value.length,
  async () => {
    await scrollToBottom()
  }
)

onMounted(async () => {
  await loadBucketPage()
  await scrollToBottom()
})
</script>

<template>
  <div class="stack message-page">
    <header class="card">
      <h2 style="margin: 0">Bucket {{ bucketDisplayName }}</h2>
      <p class="muted" style="margin: 8px 0 0">WhatsApp-style thread view for messages in this bucket.</p>
    </header>

    <section class="card stack" aria-live="polite">
      <div class="row" style="justify-content: space-between; align-items: center">
        <h3 style="margin: 0">Bucket Metadata</h3>
        <div class="row" style="gap: 8px">
          <NuxtLink
            class="btn"
            :to="`/messages/bucket/members/${encodeURIComponent(bucketId)}?namespaceId=${encodeURIComponent(bucket?.namespaceId ?? '')}`"
          >
            Manage Members
          </NuxtLink>
          <button class="btn" type="button" :disabled="bucketLoading || messagesLoading" @click="loadBucketPage">
            {{ bucketLoading || messagesLoading ? "Loading..." : "Reload" }}
          </button>
        </div>
      </div>

      <LoadingBar v-if="bucketLoading" label="Loading bucket metadata..." />
      <p v-if="bucketError" style="margin: 0; color: var(--status-error)">{{ bucketError }}</p>

      <dl v-if="!bucketLoading && !bucketError && bucketMetadata.length" class="bucket-metadata">
        <div v-for="entry in bucketMetadata" :key="`bucket-${entry.key}`" class="bucket-metadata-item">
          <dt>{{ entry.key }}</dt>
          <dd>{{ entry.value }}</dd>
        </div>
      </dl>

      <p v-if="!bucketLoading && !bucketError && !bucketMetadata.length" class="muted" style="margin: 0">
        No metadata found for this bucket.
      </p>
    </section>

    <section class="card stack" aria-live="polite">
      <div class="row" style="justify-content: space-between; align-items: center">
        <h3 style="margin: 0">Admins</h3>
        <NuxtLink
          class="btn"
          :to="`/messages/bucket/members/${encodeURIComponent(bucketId)}?role=admin&namespaceId=${encodeURIComponent(bucket?.namespaceId ?? '')}`"
        >
          Add Admin
        </NuxtLink>
      </div>
      <LoadingBar v-if="bucketLoading" label="Loading admins..." />
      <p v-else-if="bucketError" style="margin: 0; color: var(--status-error)">{{ bucketError }}</p>
      <p v-else-if="membersError" style="margin: 0; color: var(--status-error)">{{ membersError }}</p>
      <ul v-else-if="bucketAdmins.length" class="bucket-members-list">
        <li v-for="adminAddress in bucketAdmins" :key="`admin-${adminAddress}`" class="bucket-member-item">
          <span>{{ formatAddress(adminAddress) }}</span>
          <button
            class="btn member-remove-btn"
            type="button"
            :disabled="Boolean(removingAdminAddress) || Boolean(removingContributorAddress) || !session.accountAddress"
            @click="removeAdmin(adminAddress)"
          >
            <Trash2 :size="14" aria-hidden="true" />
            <span>{{ removingAdminAddress === adminAddress ? "Removing..." : "Remove" }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="muted" style="margin: 0">No admins found for this bucket.</p>
    </section>

    <section class="card stack" aria-live="polite">
      <div class="row" style="justify-content: space-between; align-items: center">
        <h3 style="margin: 0">Contributors</h3>
        <NuxtLink
          class="btn"
          :to="`/messages/bucket/members/${encodeURIComponent(bucketId)}?role=contributor&namespaceId=${encodeURIComponent(bucket?.namespaceId ?? '')}`"
        >
          Add Contributor
        </NuxtLink>
      </div>
      <LoadingBar v-if="bucketLoading" label="Loading contributors..." />
      <p v-else-if="bucketError" style="margin: 0; color: var(--status-error)">{{ bucketError }}</p>
      <p v-else-if="membersError" style="margin: 0; color: var(--status-error)">{{ membersError }}</p>
      <ul v-else-if="bucketContributors.length" class="bucket-members-list">
        <li v-for="contributorAddress in bucketContributors" :key="`contributor-${contributorAddress}`" class="bucket-member-item">
          <div class="contributor-details">
            <span>{{ formatAddress(contributorAddress) }}</span>
            <span class="muted contributor-key">
              X25519: {{ contributorX25519Keys[contributorAddress] || (loadingContributorKeys ? "Loading..." : "Not found") }}
            </span>
          </div>
          <button
            class="btn member-remove-btn"
            type="button"
            :disabled="Boolean(removingAdminAddress) || Boolean(removingContributorAddress) || !session.accountAddress"
            @click="removeContributor(contributorAddress)"
          >
            <Trash2 :size="14" aria-hidden="true" />
            <span>{{ removingContributorAddress === contributorAddress ? "Removing..." : "Remove" }}</span>
          </button>
        </li>
      </ul>
      <p v-if="!session.accountAddress" class="muted" style="margin: 0">
        Connect wallet on the dashboard first to remove bucket members.
      </p>
      <p
        v-if="!bucketLoading && !bucketError && !membersError && !bucketContributors.length"
        class="muted"
        style="margin: 0"
      >
        No contributors found for this bucket.
      </p>
    </section>

    <section class="card stack" aria-live="polite">
      <div class="row" style="justify-content: space-between; align-items: center">
        <h3 style="margin: 0">Communication Encryption Key</h3>
        <button
          class="btn btn-primary"
          type="button"
          :disabled="
            generatingEncryptionKey ||
            !session.accountAddress ||
            !connectedAdmin ||
            loadingContributorKeys ||
            !contributorRecipients.length
          "
          @click="generateAndShareEncryptionKey"
        >
          {{ generatingEncryptionKey ? "Generating..." : "Generate & Share New Key" }}
        </button>
      </div>

      <p class="muted" style="margin: 0">
        Generates a fresh X25519 encryption keypair, stores the public key ID on-chain, ensures the key-sharing tag exists,
        then encrypts and shares the new secret key for contributors using their loaded X25519 keys.
      </p>

      <ul class="key-rotation-checks">
        <li>Connected admin: {{ connectedAdmin ? "Yes" : "No" }}</li>
        <li>Contributors with X25519: {{ contributorRecipients.length }} / {{ bucketContributors.length }}</li>
        <li v-if="contributorsMissingEncryptionKey">Missing contributor keys: {{ contributorsMissingEncryptionKey }}</li>
        <li v-if="latestGeneratedKeyId">Last generated key ID: {{ latestGeneratedKeyId }}</li>
      </ul>

      <p v-if="!session.accountAddress" class="muted" style="margin: 0">
        Connect wallet on the dashboard first to rotate and share bucket encryption keys.
      </p>
      <p v-else-if="!connectedAdmin" class="muted" style="margin: 0">
        Only bucket admins can generate and distribute encryption keys.
      </p>

      <p v-if="encryptionKeyError" style="margin: 0; color: var(--status-error)">
        {{ encryptionKeyError }}
      </p>
      <p v-if="encryptionKeySuccess" class="status-success" style="margin: 0">
        {{ encryptionKeySuccess }}
      </p>

      <div v-if="latestGeneratedPublicJwk" class="key-preview-wrap">
        <p class="muted" style="margin: 0">Latest generated bucket public JWK</p>
        <pre class="key-preview">{{ latestGeneratedPublicJwk }}</pre>
      </div>
    </section>

    <section class="card stack chat-shell" aria-live="polite">
      <div class="row" style="justify-content: space-between; align-items: center">
        <h3 style="margin: 0">Conversation</h3>
        <div class="row" style="gap: 8px">
          <NuxtLink class="btn" to="/messages">Back</NuxtLink>
          <button class="btn" type="button" :disabled="messagesLoading || bucketLoading" @click="loadBucketPage">
            {{ messagesLoading || bucketLoading ? "Loading..." : "Reload" }}
          </button>
        </div>
      </div>

      <LoadingBar v-if="messagesLoading" label="Loading messages..." />

      <p v-if="messagesError" style="margin: 0; color: var(--status-error)">{{ messagesError }}</p>

      <div ref="chatViewport" class="chat-viewport" role="log" aria-live="polite" aria-label="Bucket conversation">
        <p v-if="!chatMessages.length && !messagesLoading" class="muted" style="margin: 0">
          No messages found for this bucket.
        </p>

        <div
          v-for="message in chatMessages"
          :key="message.id"
          class="chat-row"
          :class="message.outgoing ? 'chat-row-outgoing' : 'chat-row-incoming'"
        >
          <article class="chat-bubble" :class="message.outgoing ? 'chat-bubble-outgoing' : 'chat-bubble-incoming'">
            <p class="chat-text">{{ message.body }}</p>
            <footer class="chat-meta">
              <span>{{ message.senderLabel }}</span>
              <span v-if="formatTimestamp(message.createdAt)">{{ formatTimestamp(message.createdAt) }}</span>
              <span v-if="message.deliveryState === 'sending'">Sending...</span>
              <span v-if="message.deliveryState === 'failed'" style="color: var(--status-error)">Failed</span>
            </footer>
          </article>
        </div>
      </div>

      <form class="chat-composer" @submit.prevent="sendMessage">
        <textarea
          v-model="sendText"
          class="input chat-input"
          name="message-text"
          placeholder="Write a message"
          rows="2"
          :disabled="sending"
        />
        <button class="btn btn-primary" type="submit" :disabled="sending || messagesLoading">
          {{ sending ? "Sending..." : "Send" }}
        </button>
      </form>

      <p v-if="!session.accountAddress" class="muted" style="margin: 0">
        Connect wallet on the dashboard first to sign and send bucket messages.
      </p>
      <p v-if="sendError" style="margin: 0; color: var(--status-error)">{{ sendError }}</p>
    </section>
  </div>
</template>

<style scoped>
.message-page {
  min-height: 0;
}

.chat-shell {
  min-height: calc(100vh - 220px);
}

.chat-viewport {
  flex: 1;
  min-height: 380px;
  max-height: 62vh;
  overflow-y: auto;
  border: 1px solid var(--border-default);
  border-radius: 14px;
  padding: 14px;
  background:
    radial-gradient(circle at 20% 20%, rgba(87, 160, 197, 0.12), transparent 30%),
    radial-gradient(circle at 80% 0%, rgba(87, 160, 197, 0.08), transparent 24%),
    var(--color-gray-50);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-row {
  display: flex;
  width: 100%;
}

.chat-row-incoming {
  justify-content: flex-start;
}

.chat-row-outgoing {
  justify-content: flex-end;
}

.chat-bubble {
  max-width: min(78%, 560px);
  border-radius: 12px;
  padding: 10px 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.06);
}

.chat-bubble-incoming {
  background: var(--color-white);
  border: 1px solid var(--border-default);
}

.chat-bubble-outgoing {
  background: #dcf8c6;
  border: 1px solid rgba(92, 135, 84, 0.25);
}

.chat-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-meta {
  margin-top: 6px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.bucket-metadata {
  margin: 10px 0 0;
  padding: 8px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.55);
  display: grid;
  gap: 6px;
}

.bucket-metadata-item {
  display: grid;
  grid-template-columns: minmax(110px, 200px) 1fr;
  gap: 8px;
  align-items: start;
}

.bucket-metadata-item dt {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-word;
}

.bucket-metadata-item dd {
  margin: 0;
  font-size: 12px;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.bucket-members-list {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: grid;
  gap: 4px;
}

.bucket-member-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.7);
}

.contributor-details {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.contributor-key {
  font-size: 12px;
  word-break: break-all;
}

.member-remove-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--status-error);
  border-color: color-mix(in srgb, var(--status-error) 50%, var(--border-default));
}

.key-rotation-checks {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary);
  display: grid;
  gap: 2px;
}

.status-success {
  color: var(--status-success, #2f7d32);
}

.key-preview-wrap {
  display: grid;
  gap: 6px;
}

.key-preview {
  margin: 0;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.7);
  padding: 8px;
  max-height: 180px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-composer {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.chat-input {
  resize: vertical;
  min-height: 56px;
}

@media (max-width: 840px) {
  .chat-shell {
    min-height: calc(100vh - 190px);
  }

  .chat-viewport {
    min-height: 320px;
    max-height: 56vh;
    padding: 10px;
  }

  .chat-bubble {
    max-width: 88%;
  }

  .chat-composer {
    flex-direction: column;
    align-items: stretch;
  }

  .bucket-metadata-item {
    grid-template-columns: 1fr;
    gap: 2px;
  }

}
</style>
