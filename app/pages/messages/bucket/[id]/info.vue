<script setup lang="ts">
import { DidCommRepository, type BucketMemberRole, type BucketMessage, type BucketRecord, type ExtrinsicUpdate } from "../../../../services/papi/didCommRepository"
import { ProfileClient } from "../../../../services/profile/profileClient"
import type { Profile } from "../../../../types/profile"
import LoadingBar from "../../../../components/common/LoadingBar.vue"
import SkeletonCard from "../../../../components/common/SkeletonCard.vue"
import { useAddress } from "../../../../composables/useAddress"
import { Trash2 } from "lucide-vue-next"
import { hexToU8a } from "@polkadot/util"
import { decodeAddress, encodeAddress, xxhashAsHex } from "@polkadot/util-crypto"
import * as jose from "jose"
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { useNuxtApp, useRoute, useRuntimeConfig } from "nuxt/app"
import { useOperationsStore } from "../../../../stores/operations"
import { useSessionStore } from "../../../../stores/session"
import { useSettingsStore } from "../../../../stores/settings"

const route = useRoute()
const { $papiClient } = useNuxtApp()
const runtimeConfig = useRuntimeConfig()
const session = useSessionStore()
const settings = useSettingsStore()
const showDebug = computed(() => settings.showMessageDebug)
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
  },
  undefined,
  undefined,
  undefined,
  String(runtimeConfig.public.subqueryIndexerUrl || "")
)

const profileClient = new ProfileClient()

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
  senderAddress?: string
  messageType?: string
  contentType?: string
  tag?: string
  reference?: string
  payloadError?: string
  payloadLength?: number
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
const messagesLoading = ref(true)
const messagesError = ref("")
const bucket = ref<BucketRecord | null>(null)
const bucketLoading = ref(true)
const bucketError = ref("")
const membersError = ref("")
const sendText = ref("")
const sendError = ref("")
const sending = ref(false)
const pendingMessages = ref<PendingChatMessage[]>([])
const messagePayloadById = ref<Record<string, string>>({})
const messagePayloadErrorById = ref<Record<string, string>>({})
const decryptedMessagePayloadById = ref<Record<string, string>>({})
const messageDecryptErrorById = ref<Record<string, string>>({})
const chatViewport = ref<HTMLElement | null>(null)
const bucketAdmins = ref<string[]>([])
const bucketContributors = ref<string[]>([])
const bucketViewers = ref<string[]>([])
const removingMemberAddress = ref("")
const memberProfiles = ref<Record<string, Profile | null>>({})
const profilesLoading = ref(false)
const loadingContributorKeys = ref(false)
const contributorX25519Keys = ref<Record<string, string>>({})
const loadingViewerKeys = ref(false)
const viewerX25519Keys = ref<Record<string, string>>({})
const currentBucketCall = ref("buckets.write")
const generatingEncryptionKey = ref(false)
const encryptionKeyError = ref("")
const encryptionKeySuccess = ref("")
const latestGeneratedKeyId = ref("")
const latestGeneratedPublicJwk = ref("")
const decryptingKeySharingPayload = ref(false)
const decryptedKeySharingPayload = ref("")
const decryptedKeySharingError = ref("")
const decryptedKeySharingSourceMessageId = ref("")
const activeBucketEncryptionSecretJwk = ref<jose.JWK | null>(null)
const bucketDisplayName = computed(() => bucket.value?.name || `Bucket ${bucketId.value}`)
const bucketCreatedAtTimestampString = ref("")
const keySharingTag = "didcomm/key-sharing-v1"
const encryptedMessageTag = "didcomm/encrypted-message-v1"

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

const viewerRecipients = computed(() => {
  return bucketViewers.value.flatMap((address) => {
    const x25519 = viewerX25519Keys.value[address]
    if (!isValidX25519(x25519)) {
      return []
    }

    return [{ address, x25519: x25519.trim() }]
  })
})

const contributorsAndViewerRecipients = computed(() => {
  return [...contributorRecipients.value, ...viewerRecipients.value]
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

const latestKeySharingChatMessage = computed(() => {
  return [...chatMessages.value]
    .filter((message) => message.tag === keySharingTag)
    .at(-1)
})

async function loadMessages() {
  messagesError.value = ""
  messagesLoading.value = true

  try {
    const loadedMessages = await didCommRepository.fetchMessages(bucketId.value)
    messages.value = loadedMessages
    await hydrateMessagePayloads(loadedMessages)
    await decryptLatestKeySharingPayload()
    await decryptReceivedMessages(loadedMessages)
  } catch (error) {
    messagesError.value = error instanceof Error ? error.message : "Unable to load messages"
  } finally {
    messagesLoading.value = false
  }
}

function parseJsonSafely(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function isX25519SecretJwk(value: unknown): value is jose.JWK {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return candidate.kty === "OKP"
    && candidate.crv === "X25519"
    && typeof candidate.x === "string"
    && candidate.x.trim().length > 0
    && typeof candidate.d === "string"
    && candidate.d.trim().length > 0
}

function extractActiveBucketSecretJwk(payload: unknown): jose.JWK | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null
  }

  const payloadRecord = payload as Record<string, unknown>
  const keys = Array.isArray(payloadRecord.keys) ? payloadRecord.keys : []

  for (const keyCandidate of keys) {
    if (isX25519SecretJwk(keyCandidate)) {
      return {
        ...keyCandidate,
        use: "enc"
      }
    }
  }

  return null
}

async function encryptOutgoingBucketMessage(plaintext: string): Promise<string> {
  const secretJwk = activeBucketEncryptionSecretJwk.value
  if (!secretJwk || !isX25519SecretJwk(secretJwk)) {
    throw new Error("No decrypted bucket encryption key is available. Decrypt latest key-sharing payload first.")
  }

  const recipientPublicJwk: jose.JWK = {
    kty: "OKP",
    crv: "X25519",
    x: secretJwk.x,
    use: "enc",
    kid: typeof secretJwk.kid === "string" ? secretJwk.kid : undefined
  }

  const publicKey = await jose.importJWK(recipientPublicJwk, "ECDH-ES+A256KW")
  const encryptor = new jose.CompactEncrypt(new TextEncoder().encode(plaintext))
    .setProtectedHeader({
      alg: "ECDH-ES+A256KW",
      enc: "A256GCM",
      typ: encryptedMessageTag,
      kid: recipientPublicJwk.kid
    })

  return await encryptor.encrypt(publicKey)
}

async function decryptLatestKeySharingPayload(): Promise<void> {
  decryptedKeySharingPayload.value = ""
  decryptedKeySharingError.value = ""
  decryptedKeySharingSourceMessageId.value = ""
  activeBucketEncryptionSecretJwk.value = null

  const sourceMessage = latestKeySharingChatMessage.value
  if (!sourceMessage) {
    decryptedKeySharingError.value = "No didcomm/key-sharing-v1 message found in this bucket yet."
    return
  }

  const sidebarSecretJwk = settings.x25519SecretJwk
  if (!sidebarSecretJwk) {
    decryptedKeySharingError.value = "Load your X25519 secret JWK in the sidebar to decrypt key-sharing payloads."
    return
  }

  const payloadCandidate = messagePayloadById.value[sourceMessage.id] ?? sourceMessage.body
  const payloadText = typeof payloadCandidate === "string" ? payloadCandidate.trim() : ""
  if (!payloadText) {
    decryptedKeySharingError.value = "Latest key-sharing payload is empty or not loaded yet."
    return
  }

  decryptingKeySharingPayload.value = true
  decryptedKeySharingSourceMessageId.value = sourceMessage.id

  try {
    const parsedPayload = parseJsonSafely(payloadText)
    if (!parsedPayload || typeof parsedPayload !== "object" || Array.isArray(parsedPayload)) {
      throw new Error("Latest key-sharing payload is not valid JWE JSON")
    }

    const privateKey = await jose.importJWK(sidebarSecretJwk as jose.JWK, "ECDH-ES+A256KW")
    const { plaintext } = await jose.generalDecrypt(parsedPayload as jose.GeneralJWE, privateKey)
    const decodedPlaintext = new TextDecoder().decode(plaintext)

    const parsedPlaintext = parseJsonSafely(decodedPlaintext)
    activeBucketEncryptionSecretJwk.value = extractActiveBucketSecretJwk(parsedPlaintext)
    if (!activeBucketEncryptionSecretJwk.value) {
      throw new Error("Decrypted key-sharing payload does not include an X25519 secret key")
    }

    if (parsedPlaintext && typeof parsedPlaintext === "object") {
      decryptedKeySharingPayload.value = JSON.stringify(parsedPlaintext, null, 2)
    } else {
      decryptedKeySharingPayload.value = decodedPlaintext
    }

    await decryptReceivedMessages(messages.value)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to decrypt key-sharing payload"
    decryptedKeySharingError.value = message
    console.error("[Bucket Messages] Failed to decrypt latest didcomm/key-sharing-v1 payload", {
      messageId: sourceMessage.id,
      error: message
    })
  } finally {
    decryptingKeySharingPayload.value = false
  }
}

function resolveMessageTag(message: BucketMessage): string | undefined {
  const rawRecord = toRecord(message.raw)
  return firstString(rawRecord, ["tag", "messageTag"])
}

function looksLikeCompactJwe(payload: string): boolean {
  const parts = payload.split(".")
  return parts.length === 5 && parts.every((part) => part.trim().length > 0)
}

async function decryptMessagePayload(payload: string): Promise<string> {
  const secretJwk = activeBucketEncryptionSecretJwk.value
  if (!secretJwk || !isX25519SecretJwk(secretJwk)) {
    throw new Error("No active bucket encryption key is available for decrypting messages")
  }

  const privateKey = await jose.importJWK(secretJwk as jose.JWK, "ECDH-ES+A256KW")
  const { plaintext } = await jose.compactDecrypt(payload, privateKey)
  return new TextDecoder().decode(plaintext)
}

async function decryptReceivedMessages(entries: BucketMessage[]): Promise<void> {
  const nextDecryptedPayloadById: Record<string, string> = {}
  const nextDecryptErrorById: Record<string, string> = {}

  await Promise.all(
    entries.map(async (entry) => {
      if (resolveMessageTag(entry) === keySharingTag) {
        return
      }

      const payload = messagePayloadById.value[entry.id]
      if (!payload) {
        return
      }

      const trimmedPayload = payload.trim()
      if (!looksLikeCompactJwe(trimmedPayload)) {
        nextDecryptedPayloadById[entry.id] = payload
        return
      }

      try {
        const decrypted = await decryptMessagePayload(trimmedPayload)
        nextDecryptedPayloadById[entry.id] = decrypted
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to decrypt message payload"
        nextDecryptErrorById[entry.id] = message
        nextDecryptedPayloadById[entry.id] = payload
        console.error("[Bucket Messages] Failed to decrypt message payload", {
          messageId: entry.id,
          error: message
        })
      }
    })
  )

  decryptedMessagePayloadById.value = nextDecryptedPayloadById
  messageDecryptErrorById.value = nextDecryptErrorById
}


const timestampStorageKey = `${xxhashAsHex("Timestamp", 128)}${xxhashAsHex("Now", 128).slice(2)}`

function parseU64FromHex(value: string): number | null {
  if (!value || !value.startsWith("0x")) return null
  const bytes = hexToU8a(value)
  if (bytes.length < 8) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Number(view.getBigUint64(0, true))
}

async function fetchTimestampForBlock(blockNumber: number): Promise<number | null> {
  try {
    const blockHash = await ($papiClient as { rpc(method: string, params?: unknown[]): Promise<string> }).rpc(
      "chain_getBlockHash",
      [blockNumber]
    )
    const storage = await ($papiClient as { rpc(method: string, params?: unknown[]): Promise<string | null> }).rpc(
      "state_getStorage",
      [timestampStorageKey, blockHash]
    )
    if (!storage) return null
    return parseU64FromHex(storage)
  } catch {
    return null
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

    // Fetch timestamp for createdAt if present
    const rawRecord = toRecord(record.raw)
    const rawMetadata = rawRecord?.metadata ? toRecord(rawRecord.metadata) : null
    const createdAtValue = rawMetadata?.createdAt ?? rawRecord?.createdAt
    if (createdAtValue !== undefined) {
      const blockNum = Number(createdAtValue)
      if (!isNaN(blockNum) && blockNum > 0) {
        fetchTimestampForBlock(blockNum).then(ts => {
          if (ts) {
            bucketCreatedAtTimestampString.value = new Date(ts).toLocaleString([], {
              month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit"
            })
          }
        }).catch(() => { })
      }
    }
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
    const [admins, contributors, viewers] = await Promise.all([
      didCommRepository.fetchBucketAdmins(bucketId.value),
      didCommRepository.fetchBucketContributors(bucketId.value),
      didCommRepository.fetchBucketViewers(bucketId.value)
    ])

    bucketAdmins.value = admins
    bucketContributors.value = contributors
    bucketViewers.value = viewers
    await Promise.all([
      loadContributorX25519Keys(contributors),
      loadViewerX25519Keys(viewers),
      loadMemberProfiles([...admins, ...contributors, ...viewers])
    ])
  } catch (error) {
    bucketAdmins.value = []
    bucketContributors.value = []
    bucketViewers.value = []
    contributorX25519Keys.value = {}
    viewerX25519Keys.value = {}
    memberProfiles.value = {}
    membersError.value = error instanceof Error ? error.message : "Unable to load bucket member lists"
  }
}

async function loadMemberProfiles(addresses: string[]): Promise<void> {
  const uniqueAddresses = Array.from(new Set(addresses.map((address) => address.trim()).filter(Boolean)))
  if (!uniqueAddresses.length) {
    memberProfiles.value = {}
    return
  }

  profilesLoading.value = true
  const profilesByAddress: Record<string, Profile | null> = {}

  try {
    await Promise.all(
      uniqueAddresses.map(async (address) => {
        try {
          // The profile API keys on the generic Substrate SS58 format (prefix 42).
          profilesByAddress[address] = await profileClient.getProfile(toSs58Prefix42(address))
        } catch {
          // Treat a failed lookup the same as a missing profile.
          profilesByAddress[address] = null
        }
      })
    )
    memberProfiles.value = profilesByAddress
  } finally {
    profilesLoading.value = false
  }
}

function toSs58Prefix42(address: string): string {
  const trimmed = address.trim()
  try {
    return encodeAddress(decodeAddress(trimmed), 42)
  } catch {
    return trimmed
  }
}

function resolveMemberName(address: string): string {
  const profile = memberProfiles.value[address]
  if (profile?.nickname) {
    return profile.nickname
  }

  // A resolved-but-missing profile is flagged explicitly; while still loading (or
  // for a profile without a nickname) fall back to the formatted address.
  if (address in memberProfiles.value && profile === null) {
    return "Profile Not Found"
  }

  return formatAddress(address)
}

function resolveRemovalRoles(address: string): BucketMemberRole[] {
  const roles: BucketMemberRole[] = []
  if (bucketAdmins.value.some((candidate) => addressesEqual(candidate, address))) {
    roles.push("admin")
  }
  if (bucketContributors.value.some((candidate) => addressesEqual(candidate, address))) {
    roles.push("contributor")
  }
  if (bucketViewers.value.some((candidate) => addressesEqual(candidate, address))) {
    roles.push("viewer")
  }
  return roles
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
    contributorX25519Keys.value = {}
  } finally {
    loadingContributorKeys.value = false
  }
}

async function loadViewerX25519Keys(addresses: string[]): Promise<void> {
  viewerX25519Keys.value = {}

  if (!addresses.length) {
    return
  }

  loadingViewerKeys.value = true
  const keysByAddress: Record<string, string> = {}

  try {
    for (const address of addresses) {
      const payload = await queryDidPayloadByAddress(address)
      keysByAddress[address] = extractContributorX25519(payload) ?? "Not found"
    }

    viewerX25519Keys.value = keysByAddress
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load viewer DID key agreements"
    membersError.value = message
    operations.add("did_read", bucketId.value, "error", message)
    viewerX25519Keys.value = {}
  } finally {
    loadingViewerKeys.value = false
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

async function removeAllRoles(address: string): Promise<void> {
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

  const roles = resolveRemovalRoles(address)
  if (!roles.length) {
    membersError.value = "This member has no removable roles"
    return
  }

  removingMemberAddress.value = address
  currentBucketCall.value = "utility.batchAll"

  try {
    const result = await didCommRepository.removeBucketMemberRoles(
      namespaceId,
      bucketId.value,
      address,
      roles,
      session.accountAddress,
      logExtrinsicUpdate
    )

    operations.add("bucket_write", result.method, "success", `Member removed (${roles.join(", ")}): ${result.txHash}`)
    await loadBucketMembers()
  } catch (error) {
    membersError.value = error instanceof Error ? error.message : "Unable to remove member"
    operations.add("bucket_write", currentBucketCall.value, "error", membersError.value)
  } finally {
    removingMemberAddress.value = ""
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
  const readerAddresses = contributorsAndViewerRecipients.value.map((recipient) => recipient.address)

  if (!readerAddresses.length) {
    throw new Error("No valid contributor or viewer X25519 keys are available for key sharing")
  }

  const recipientJwks: jose.JWK[] = [bucketPublicJwk]
  for (const recipient of contributorsAndViewerRecipients.value) {
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

    console.log("--- [ADMIN] 4b. Preparing recipients and encrypting key-sharing payload ---")
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
    console.log("--- [ADMIN] 4c. Submitting utility.batchAll for resumeWriting + createTag + write ---")
    currentBucketCall.value = "utility.batchAll"
    const batchResult = await didCommRepository.rotateBucketKeyAndShare(
      namespaceId,
      bucketId.value,
      bucketEncryptionKey,
      keySharingTag,
      jweString,
      session.accountAddress,
      logExtrinsicUpdate
    )
    console.log(`✅ Bucket key rotation + tag + key-sharing message finalized in batchAll. Transaction Hash: ${batchResult.txHash}`)

    latestGeneratedKeyId.value = keyId
    latestGeneratedPublicJwk.value = JSON.stringify(bucketPkJwk, null, 2)
    encryptionKeySuccess.value = `New encryption key generated and shared. keyId=${keyId}`

    operations.add(
      "bucket_write",
      batchResult.method,
      "success",
      `Bucket key rotated and shared via batchAll. keyId=${keyId}, tx=${batchResult.txHash}`
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

function readPath(record: Record<string, unknown> | undefined, path: string): unknown {
  if (!record) {
    return undefined
  }

  const segments = path.split(".").filter((segment) => segment.trim().length > 0)
  let current: unknown = record

  for (const segment of segments) {
    const currentRecord = toRecord(current)
    if (!currentRecord) {
      return undefined
    }

    current = currentRecord[segment]
  }

  return current
}

function firstStringAtPaths(record: Record<string, unknown> | undefined, paths: string[]): string | undefined {
  for (const path of paths) {
    const candidate = textValue(readPath(record, path))
    if (candidate && candidate.trim()) {
      return candidate.trim()
    }
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

function summarizeJsonPayload(payload: string): string | undefined {
  const parsed = tryParseJsonRecord(payload)
  if (!parsed) {
    return undefined
  }

  const directText =
    firstString(parsed, ["message", "content", "payload", "body", "text", "summary"]) ??
    firstStringAtPaths(parsed, ["data.message", "data.content", "data.body"])

  if (directText) {
    return directText
  }

  return JSON.stringify(parsed, null, 2)
}

function resolveMessageReference(message: BucketMessage): string | undefined {
  const rawRecord = toRecord(message.raw)

  return (
    firstString(rawRecord, ["reference", "ref", "cid", "ipfsCid", "messageCid"]) ??
    firstStringAtPaths(rawRecord, [
      "metadata.ref",
      "metadata.reference",
      "metadata.cid",
      "metadataInput.ref",
      "metadataInput.reference",
      "value.ref",
      "value.reference",
      "messageInput.ref",
      "messageInput.reference"
    ])
  )
}

function extractCidFromReference(reference: string): string | undefined {
  const trimmed = reference.trim()
  if (!trimmed) {
    return undefined
  }

  if (/^[a-z0-9]+$/i.test(trimmed) && trimmed.length >= 32) {
    return trimmed
  }

  if (trimmed.startsWith("ipfs://")) {
    const withoutScheme = trimmed.slice("ipfs://".length).replace(/^ipfs\//i, "")
    const [cidCandidate] = withoutScheme.split(/[/?#]/)
    return cidCandidate?.trim() || undefined
  }

  try {
    const parsedUrl = new URL(trimmed)
    const pathSegments = parsedUrl.pathname.split("/").filter((segment) => segment.trim().length > 0)
    const ipfsIndex = pathSegments.findIndex((segment) => segment.toLowerCase() === "ipfs")

    if (ipfsIndex >= 0) {
      const cidCandidate = pathSegments[ipfsIndex + 1]
      if (cidCandidate?.trim()) {
        return cidCandidate.trim()
      }
    }

    return undefined
  } catch {
    return undefined
  }
}

function resolvePayloadUrl(reference: string): string {
  const trimmed = reference.trim()
  if (!trimmed) {
    throw new Error("Message reference is empty")
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  const cid = extractCidFromReference(trimmed)
  if (!cid) {
    throw new Error("Message reference is not a valid CID or URL")
  }

  return `${resolveGatewayUrl()}/ipfs/${cid}`
}

function resolveGatewayUrl(): string {
  const configured = asOptionalString(runtimeConfig.public.pinataGateway)
  const fallback = "https://gateway.pinata.cloud/ipfs"
  const base = configured ?? fallback
  return base.replace(/\/+$/, "")
}

async function fetchPayloadFromReference(reference: string): Promise<string> {
  const response = await fetch(resolvePayloadUrl(reference))
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return await response.text()
}

async function hydrateMessagePayloads(entries: BucketMessage[]): Promise<void> {
  const nextPayloadById: Record<string, string> = {}
  const nextErrorById: Record<string, string> = {}

  await Promise.all(
    entries.map(async (entry) => {
      const reference = resolveMessageReference(entry)
      if (!reference) {
        return
      }

      const cachedPayload = messagePayloadById.value[entry.id]
      if (cachedPayload) {
        nextPayloadById[entry.id] = cachedPayload
        return
      }

      try {
        const payload = await fetchPayloadFromReference(reference)
        nextPayloadById[entry.id] = payload
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to resolve message payload"
        nextErrorById[entry.id] = message

        if (message.includes("HTTP 400")) {
          console.error("[Bucket Messages] Payload unavailable (HTTP 400)", {
            messageId: entry.id,
            reference,
            error: message
          })
        }
      }
    })
  )

  messagePayloadById.value = nextPayloadById
  messagePayloadErrorById.value = nextErrorById
}

function resolveMessageType(contentType: string | undefined, tag: string | undefined, payload: string | undefined): string | undefined {
  if (contentType) {
    return contentType
  }

  if (tag) {
    return tag
  }

  if (!payload) {
    return undefined
  }

  const parsed = tryParseJsonRecord(payload)
  return firstString(parsed, ["type", "messageType"])
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
  const metadataRecord =
    toRecord(rawRecord?.metadataInput) ??
    toRecord(rawRecord?.metadata) ??
    toRecord(rawRecord?.messageMetadata)
  const reference = resolveMessageReference(message)
  const payload = decryptedMessagePayloadById.value[message.id] ?? messagePayloadById.value[message.id]
  const payloadError = messagePayloadErrorById.value[message.id] ?? messageDecryptErrorById.value[message.id]
  const payloadBody = payload ? summarizeJsonPayload(payload) ?? payload : undefined
  const body = payloadBody ?? firstString(rawRecord, ["message", "content", "payload", "body", "text", "summary"]) ?? message.summary
  const contentType =
    firstString(metadataRecord, ["contentType", "mimeType", "type"]) ??
    firstString(rawRecord, ["contentType", "mimeType"])
  const tag = firstString(rawRecord, ["tag", "messageTag"])
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
    senderLabel: outgoing ? "You" : sender ? formatAddress(sender) : "Unknown",
    senderAddress: sender,
    contentType,
    tag,
    reference,
    messageType: resolveMessageType(contentType, tag, payload),
    payloadError,
    payloadLength: payload ? payload.length : undefined
  }
}

function formatMessageMeta(message: ChatMessage): string {
  if (message.createdAt.getTime() === 0) {
    return ""
  }

  const timestamp = message.createdAt.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })

  const prefix = message.outgoing ? "Sent" : "Received"
  const base = `${prefix} ${timestamp}`

  if (message.deliveryState === "sending") {
    return `${base} | Sending...`
  }

  if (message.deliveryState === "failed") {
    return `${base} | Failed`
  }

  return base
}

function buildMessageDebugEntries(message: ChatMessage): MetadataEntry[] {
  const entries: MetadataEntry[] = []
  const cid = message.reference ? extractCidFromReference(message.reference) : undefined

  const pushEntry = (key: string, value: unknown) => {
    if (value === undefined || value === null) {
      return
    }

    const formatted = String(value).trim()
    if (!formatted) {
      return
    }

    entries.push({ key, value: formatted })
  }

  pushEntry("Message ID", message.id)
  pushEntry("Direction", message.outgoing ? "outgoing" : "incoming")
  pushEntry("Sender Label", message.senderLabel)
  pushEntry("Sender Address", message.senderAddress)
  if (message.createdAt.getTime() > 0) {
    pushEntry("Created At", message.createdAt.toISOString())
  }
  pushEntry("Message Type", message.messageType)
  pushEntry("Content Type", message.contentType)
  pushEntry("Tag", message.tag)
  pushEntry("Reference", message.reference)
  pushEntry("IPFS CID", cid)
  if (message.payloadLength !== undefined) {
    pushEntry("Payload Length", `${message.payloadLength} chars`)
  }
  pushEntry("Payload Error", message.payloadError)
  pushEntry("Delivery State", message.deliveryState)

  return entries
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
    const encryptedPayload = await encryptOutgoingBucketMessage(payload)
    const result = await didCommRepository.createMessage(
      bucketId.value,
      encryptedPayload,
      session.accountAddress,
      logExtrinsicUpdate
    )
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

watch(
  () => settings.x25519SecretJwk,
  async () => {
    await decryptLatestKeySharingPayload()
    await decryptReceivedMessages(messages.value)
  },
  { deep: true }
)

onMounted(async () => {
  settings.initialize()
  await loadBucketPage()
  await scrollToBottom()
})

const allMembers = computed(() => {
  const membersMap = new Map()

  for (const admin of bucketAdmins.value) {
    membersMap.set(admin, { address: admin, roles: ['admin'] })
  }

  for (const contributor of bucketContributors.value) {
    if (membersMap.has(contributor)) {
      membersMap.get(contributor).roles.push('contributor')
    } else {
      membersMap.set(contributor, { address: contributor, roles: ['contributor'] })
    }
  }

  for (const viewer of bucketViewers.value) {
    if (!membersMap.has(viewer)) {
      membersMap.set(viewer, { address: viewer, roles: ['viewer'] })
    }
  }

  return Array.from(membersMap.values())
})
</script>

<template>
  <div class="chat-custom-page">
    <div class="info-content-scroll stack">
      <section class="stack" aria-live="polite">
        <div class="row buckets-header" style="justify-content: space-between; align-items: center">
          <div class="row" style="gap: 12px; align-items: center">
            <div class="stack" style="gap: 4px">
              <h3 style="margin: 0">{{ bucketDisplayName }}</h3>
            </div>
          </div>
        </div>

        <div class="card stack" style="gap: 16px;">
          <div class="row" style="justify-content: space-between; align-items: center">
            <h4
              style="margin: 0; font-size: 16px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              Metadata</h4>

          </div>
          <SkeletonCard v-if="bucketLoading" :count="2" :lines="2" />
          <p v-if="bucketError" style="margin: 0; color: var(--status-error)">{{ bucketError }}</p>

          <dl v-if="!bucketLoading && !bucketError && bucketMetadata.length" class="bucket-metadata"
            style="background: none; border: none; padding: 0;">
            <div v-for="entry in bucketMetadata" :key="`bucket-${entry.key}`" class="bucket-metadata-item"
              style="border-bottom: 1px solid var(--border-default); padding-bottom: 8px;">
              <dt style="font-weight: 600;">{{ entry.key.replace('metadata.', '').replace('status.', '') }}</dt>
              <dd v-if="entry.key.includes('createdAt') && bucketCreatedAtTimestampString">
                {{ bucketCreatedAtTimestampString }}
                <span v-if="showDebug" class="muted" style="font-size: 11px; margin-left: 6px;">(Block: {{ entry.value
                }})</span>
              </dd>
              <dd v-else-if="entry.key.toLowerCase().includes('category') && entry.value.trim() === '0x'">None</dd>
              <dd v-else>{{ entry.value }}</dd>
            </div>
          </dl>
          <p v-if="!bucketLoading && !bucketError && !bucketMetadata.length" class="muted" style="margin: 0">
            No metadata found for this bucket.
          </p>
        </div>

        <div class="card stack" style="gap: 16px;">
          <div class="row members-header"
            style="justify-content: space-between; align-items: center; flex-wrap: nowrap; gap: 12px;">
            <h4
              style="margin: 0; font-size: 16px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              Members</h4>
            <div class="row" style="gap: 8px; flex: 0 0 auto; flex-wrap: nowrap;">
              <NuxtLink class="btn" style="flex-shrink: 0; white-space: nowrap;"
                :to="`/messages/bucket/add-member/${encodeURIComponent(bucketId)}?namespaceId=${encodeURIComponent(bucket?.namespaceId ?? '')}`">
                Add Member
              </NuxtLink>
            </div>
          </div>

          <SkeletonCard v-if="bucketLoading" :count="3" :lines="1" />
          <p v-if="membersError" style="margin: 0; color: var(--status-error)">{{ membersError }}</p>

          <ul v-if="allMembers.length" class="bucket-members-list"
            style="display: flex; flex-direction: column; gap: 8px; list-style: none; padding: 0; margin: 0;">
            <li v-for="member in allMembers" :key="member.address"
              :style="{ padding: '12px 16px', background: '#f6f7f9', margin: 0, border: '1px solid var(--border-default)', borderRadius: '8px', display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: '8px', width: '100%', boxSizing: 'border-box', minWidth: 0 }">
              <strong
                :style="{ fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 0 0%', minWidth: 0 }">{{
                  resolveMemberName(member.address) }}</strong>
              <span v-for="role in member.roles" :key="role"
                :style="{ padding: '4px 8px', borderRadius: '999px', fontSize: '11px', color: 'white', fontWeight: '600', textTransform: 'capitalize', background: 'var(--color-primary)', flexShrink: 0, whiteSpace: 'nowrap' }">
                {{ role }}
              </span>
              <button class="btn member-remove-btn" type="button" title="Remove"
                :disabled="Boolean(removingMemberAddress) || !session.accountAddress"
                @click="removeAllRoles(member.address)"
                :style="{ background: 'var(--color-white)', flexShrink: 0, padding: '4px 6px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap', minWidth: 'auto', maxWidth: '120px', overflow: 'hidden' }">
                <Trash2 v-if="removingMemberAddress !== member.address" :size="14" aria-hidden="true" />
                <span v-else class="spinner-small"></span>
                <span :style="{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }">{{
                  removingMemberAddress === member.address ? "Removing..." : "Remove" }}</span>
              </button>
            </li>
          </ul>
          <p v-else-if="!bucketLoading && !membersError" class="muted" style="margin: 0">
            No members found for this bucket.
          </p>
        </div>

        <div class="card stack" style="gap: 16px;">
          <div class="row" style="justify-content: space-between; align-items: center">
            <h4 style="margin: 0; font-size: 16px;">Communication Encryption Key</h4>
            <button class="btn btn-primary" type="button" :disabled="generatingEncryptionKey ||
              !session.accountAddress ||
              !connectedAdmin ||
              loadingContributorKeys ||
              loadingViewerKeys ||
              !contributorsAndViewerRecipients.length
              " @click="generateAndShareEncryptionKey">
              {{ generatingEncryptionKey ? "Generating..." : "Generate & Share New Key" }}
            </button>
          </div>

          <p class="muted" style="margin: 0">
            Generates a fresh X25519 encryption keypair, stores the public key ID on-chain, ensures the key-sharing tag
            exists,
            then encrypts and shares the new secret key for contributors and viewers using their loaded X25519 keys.
          </p>

          <ul class="key-rotation-checks"
            style="background: #f6f7f9; padding: 12px 12px 12px 32px; border-radius: 8px;">
            <li>Contributors with X25519: {{ contributorRecipients.length }} / {{ bucketContributors.length }}</li>
            <li>Viewers with X25519: {{ viewerRecipients.length }} / {{ bucketViewers.length }}</li>
            <li v-if="latestGeneratedKeyId">Last generated key ID: {{ latestGeneratedKeyId }}</li>
          </ul>

          <p v-if="!connectedAdmin" class="muted" style="margin: 0">
            Only bucket admins can generate and distribute encryption keys.
          </p>

          <p v-if="encryptionKeyError" style="margin: 0; color: var(--status-error)">
            {{ encryptionKeyError }}
          </p>
          <p v-if="encryptionKeySuccess" class="status-success" style="margin: 0; color: var(--status-success);">
            {{ encryptionKeySuccess }}
          </p>

          <div v-if="latestGeneratedPublicJwk" class="key-preview-wrap">
            <p class="muted" style="margin: 0">Latest generated bucket public JWK</p>
            <pre class="key-preview" style="background: #f6f7f9;">{{ latestGeneratedPublicJwk }}</pre>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.chat-custom-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  margin: -24px;
  background: #f7f8fa;
  overflow: hidden;
}

.info-content-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  overscroll-behavior: contain;
}

@media (max-width: 960px) {
  .chat-custom-page {
    height: calc(100vh - 56px);
    margin: -16px;
  }

  .info-content-scroll {
    padding: 16px;
  }
}

.message-page {
  min-height: 0;
}

.collapsible-card {
  padding: 0;
  overflow: hidden;
}

.collapsible-summary {
  list-style: none;
  cursor: pointer;
  padding: 14px 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.collapsible-summary::-webkit-details-marker {
  display: none;
}

.collapsible-summary::after {
  content: "+";
  font-size: 16px;
  color: var(--text-secondary);
}

.collapsible-card[open] .collapsible-summary::after {
  content: "-";
}

.collapsible-body {
  padding: 0 16px 16px;
}

.chat-shell {
  min-height: 100vh;
  padding: 0;
  overflow: hidden;
  background: var(--color-white);
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-default);
  border-bottom: 1px solid var(--border-default);
}

.chat-header {
  display: grid;
  grid-template-columns: 40px 1fr 40px;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-default);
  background: var(--color-white);
}

.chat-header-title {
  text-align: center;
  display: grid;
  gap: 2px;
}

.chat-header-title h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-primary);
}

.chat-header-kicker {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.chat-icon-button {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: var(--color-white);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-weight: 600;
  transition: border-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
}

.chat-icon-button:hover:not(:disabled),
.chat-icon-button:focus-visible:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
}

.chat-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.chat-viewport {
  flex: 1;
  min-height: 380px;
  max-height: none;
  overflow-y: auto;
  padding: 16px 18px 24px;
  background: #f7f8fa;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overscroll-behavior: contain;
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

.chat-message {
  max-width: min(78%, 560px);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.chat-row-outgoing .chat-message {
  align-items: flex-end;
}

.chat-sender {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
}

.chat-bubble {
  width: 100%;
  border-radius: 14px;
  padding: 12px 14px;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.06);
}

.chat-bubble-incoming {
  background: color-mix(in srgb, var(--color-primary) 6%, var(--color-white));
  border: 1px solid color-mix(in srgb, var(--color-primary) 35%, var(--border-default));
  border-left: 3px solid var(--color-primary);
  padding-left: 12px;
}

.chat-bubble-outgoing {
  background: var(--color-primary);
  border: 1px solid color-mix(in srgb, var(--color-primary) 70%, #000000);
}

.chat-bubble-outgoing .chat-text,
.chat-bubble-outgoing .chat-description,
.chat-bubble-outgoing .chat-debug,
.chat-bubble-outgoing .chat-debug summary,
.chat-bubble-outgoing .chat-debug-item dt,
.chat-bubble-outgoing .chat-debug-item dd {
  color: rgba(255, 255, 255, 0.92);
}

.chat-bubble-outgoing .chat-warning {
  color: rgba(255, 255, 255, 0.9);
}

.chat-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-warning {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--status-error);
}

.chat-debug {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.chat-debug summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--text-primary);
}

.chat-debug-grid {
  margin: 8px 0 0;
  display: grid;
  gap: 6px;
}

.chat-debug-item {
  display: grid;
  grid-template-columns: minmax(120px, 160px) 1fr;
  gap: 8px;
  word-break: break-word;
}

.chat-debug-item dt {
  margin: 0;
  font-weight: 600;
  color: var(--text-secondary);
}

.chat-debug-item dd {
  margin: 0;
  color: var(--text-primary);
  white-space: pre-wrap;
}

.chat-timestamp {
  margin: 0;
  font-size: 11px;
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
  gap: 2px;
  padding: 2px 6px;
  font-size: 11px;
  white-space: nowrap;
  min-width: auto;
  height: 28px;
  color: var(--status-error);
  border-color: color-mix(in srgb, var(--status-error) 50%, var(--border-default));
}

@media (max-width: 600px) {
  .member-remove-btn span:not(.spinner-small) {
    display: none;
  }
}

.spinner-small {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0, 0, 0, 0.1);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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
  align-items: stretch;
  padding: 12px 14px 16px;
  border-top: 1px solid var(--border-default);
  background: var(--color-white);
}

.chat-input {
  resize: none;
  min-height: 48px;
  height: 48px;
  border-radius: 999px;
  padding: 12px 16px;
  background: #f6f7f9;
  border: none;
  box-shadow: none;
  flex: 1;
  line-height: 24px;
}

.chat-send-btn {
  border-radius: 999px;
  padding: 10px 18px;
  min-height: 48px;
  border: none;
}

@media (max-width: 840px) {
  .chat-shell {
    min-height: 100vh;
  }

  .chat-viewport {
    min-height: 320px;
    max-height: none;
    padding: 12px 12px 20px;
  }

  .chat-message {
    max-width: 100%;
  }

  .chat-composer {
    flex-direction: column;
    align-items: stretch;
  }

  .chat-debug-item {
    grid-template-columns: 1fr;
  }

  .bucket-metadata-item {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
</style>
