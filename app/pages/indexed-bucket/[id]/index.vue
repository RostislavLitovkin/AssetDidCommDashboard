<script setup lang="ts">
import { fetchIndexedBucketDetail, fetchIndexedMessagesByTag, fetchIndexedNamespaceManagers, type IndexedBucket, type IndexedMessage, type IndexedBucketMember, type IndexedBucketViewer } from "../../../services/indexer/subqueryClient"
import { DidCommRepository, type ExtrinsicUpdate } from "../../../services/papi/didCommRepository"
import { ProfileClient } from "../../../services/profile/profileClient"
import { resolveAvatarUrls, toSs58Prefix42 } from "../../../services/profile/avatarResolver"
import LoadingBar from "../../../components/common/LoadingBar.vue"
import ChatMessageEntry, { type ChatMessageProps, type ChatMessageAttachment } from "../../../components/common/ChatMessageEntry.vue"
import { Paperclip, X, SendHorizontal, Wallet, ShieldAlert, UserPlus, KeyRound, Check } from "lucide-vue-next"
import { hexToU8a } from "@polkadot/util"
import { useAddress } from "../../../composables/useAddress"
import { useWallet } from "../../../composables/useWallet"
import * as jose from "jose"
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { useNuxtApp, useRoute, useRuntimeConfig } from "nuxt/app"
import { useOperationsStore } from "../../../stores/operations"
import { useSessionStore } from "../../../stores/session"
import { useSettingsStore } from "../../../stores/settings"

const route = useRoute()
const config = useRuntimeConfig()
const { $papiClient } = useNuxtApp()
const session = useSessionStore()
const settings = useSettingsStore()
const operations = useOperationsStore()
const { formatAddress, addressesEqual } = useAddress()
const wallet = useWallet()

// Wallet popup state
const showWalletPopup = ref(false)
const walletAccounts = ref<Array<{ address: string; name: string; source: string }>>([])
const loadingWalletAccounts = ref(false)
const selectingWallet = ref(false)

async function openWalletPopup(): Promise<void> {
  showWalletPopup.value = true
  loadingWalletAccounts.value = true
  try {
    walletAccounts.value = await wallet.listAccounts()
  } finally {
    loadingWalletAccounts.value = false
  }
}

async function selectWalletAccount(address: string): Promise<void> {
  selectingWallet.value = true
  try {
    await wallet.connectToAddress(address)
    showWalletPopup.value = false
  } finally {
    selectingWallet.value = false
  }
}

const asOptionalString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

const didCommRepository = new DidCommRepository(
  $papiClient as { rpc(method: string, params?: unknown[]): Promise<unknown>; getEndpoint?(): string },
  // Positional args 2-15 (extrinsic submitters / storage readers) use their defaults.
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  { // 16 pinataConfig
    jwt: asOptionalString(config.public.pinataJwt),
    apiKey: asOptionalString(config.public.pinataApiKey),
    apiSecret: asOptionalString(config.public.pinataApiSecret),
    publicGateway: asOptionalString(config.public.pinataGateway)
  },
  undefined, // 17 submitBucketKeyRotationBatchExtrinsic
  undefined, // 18 submitAddNamespaceManagerExtrinsic
  undefined, // 19 submitRemoveNamespaceManagerExtrinsic
  String(config.public.subqueryIndexerUrl || "") // 20 indexerUrl
)
const profileClient = new ProfileClient()

const indexerUrl = computed(() => String(config.public.subqueryIndexerUrl || ""))
const pinataGateway = computed(() => {
  const gw = String(config.public.pinataGateway || "https://gateway.pinata.cloud/ipfs")
  return gw.replace(/\/+$/, "")
})

const bucketId = computed(() => {
  const raw = route.params.id
  const v = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "")
  try { return decodeURIComponent(String(v)) } catch { return String(v) }
})

// ── State ──────────────────────────────────────────────────────────
const loading = ref(true)
const error = ref("")
const bucket = ref<IndexedBucket | null>(null)
const admins = ref<IndexedBucketMember[]>([])
const contributors = ref<IndexedBucketMember[]>([])
const viewers = ref<IndexedBucketViewer[]>([])
const namespaceManagers = ref<string[]>([])
const messages = ref<IndexedMessage[]>([])
const avatarUrlByAddress = ref<Record<string, string>>({})
const profilesByAddress = ref<Record<string, import("../../../types/profile").Profile>>({})

const payloadById = ref<Record<string, string>>({})
const payloadErrorById = ref<Record<string, string>>({})
const decryptedById = ref<Record<string, string>>({})
const decryptErrorById = ref<Record<string, string>>({})
const attachmentById = ref<Record<string, ChatMessageAttachment>>({})
const activeSecretJwk = ref<jose.JWK | null>(null)
const keySharingError = ref("")
const blockTimestamps = ref<Record<number, string>>({})

const sendText = ref("")
const sendError = ref("")
const sending = ref(false)
const creatingKey = ref(false)
const createKeyError = ref("")
const pendingAttachment = ref<{ file: File; dataUrl: string } | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const keySharingTag = "didcomm/key-sharing-v1"
const bucketDisplayName = computed(() => bucket.value?.name || `Bucket ${bucketId.value}`)
const connectedAdmin = computed(() => {
  if (!session.accountAddress) return false
  return admins.value.some(a => addressesEqual(a.subjectId, session.accountAddress!))
})
const connectedContributor = computed(() => {
  if (!session.accountAddress) return false
  return contributors.value.some(c => addressesEqual(c.subjectId, session.accountAddress!))
})
const connectedAdminOrContributor = computed(() => connectedAdmin.value || connectedContributor.value)
const connectedNamespaceManager = computed(() => {
  if (!session.accountAddress) return false
  return namespaceManagers.value.some(m => addressesEqual(m, session.accountAddress!))
})
const canManageBucket = computed(() => connectedAdmin.value || connectedNamespaceManager.value)

// ── Empty-bucket setup timeline ────────────────────────────────────
const memberCount = computed(() => {
  const unique = new Set<string>()
  for (const member of [...admins.value, ...contributors.value]) unique.add(member.subjectId)
  return unique.size
})

// Viewers are keyed on-chain by their X25519 key, so the identifier itself is the key.
const viewerRecipients = computed(() => {
  return viewers.value.flatMap(viewer => {
    const x25519 = normalizeX25519Value(viewer.subjectId)
    return x25519 ? [{ address: viewer.subjectId, x25519 }] : []
  })
})

const keyStepActive = computed(() => memberCount.value >= 2)
const showSetupTimeline = computed(() =>
  !loading.value && !error.value && Boolean(bucket.value) && !messages.value.length && canManageBucket.value
)

const addMemberUrl = computed(() => {
  const namespaceId = bucket.value?.namespaceId != null ? String(bucket.value.namespaceId) : ""
  return `/messages/bucket/add-member/${encodeURIComponent(bucketId.value)}?namespaceId=${encodeURIComponent(namespaceId)}`
})

// ── Block timestamp caching ────────────────────────────────────────
let timestampLoading = false
async function loadBlockTimestamp(blockNumber: number): Promise<string> {
  const cached = blockTimestamps.value[blockNumber]
  if (cached) return cached

  try {
    const block = await $papiClient.rpc("chain_getBlock", [`0x${blockNumber.toString(16)}`])
    const timestamp = block?.block?.header?.timestamp as number | undefined
    if (timestamp) {
      const date = new Date(timestamp)
      const formatted = date.toLocaleString()
      blockTimestamps.value[blockNumber] = formatted
      return formatted
    }
  } catch {
    // Fallback to block number if timestamp lookup fails
  }

  // Fallback: estimate based on ~6 seconds per block from genesis
  const genesisTime = 1690000000000 // Approximate genesis time (JULY 2023)
  const estimatedTime = genesisTime + blockNumber * 6000
  const date = new Date(estimatedTime)
  return date.toLocaleString()
}

async function lazyLoadBlockTimestamps() {
  if (timestampLoading) return
  timestampLoading = true
  try {
    // Load timestamps for all unique blocks in messages
    const blocks = new Set(messages.value.map(m => m.createdBlock))
    for (const blockNumber of blocks) {
      await loadBlockTimestamp(blockNumber)
    }
  } finally {
    timestampLoading = false
  }
}

// ── Chat message rendering ─────────────────────────────────────────
const chatMessages = computed<ChatMessageProps[]>(() => {
  // Sort messages chronologically so oldest is at the top, newest at the bottom
  const sortedMessages = [...messages.value].sort((a, b) => a.createdBlock - b.createdBlock)

  return sortedMessages.map(m => {
    const payload = decryptedById.value[m.id] ?? payloadById.value[m.id]
    const payloadBody = payload ? summarize(payload) ?? payload : undefined
    const body = payloadBody ?? m.description ?? m.ipfsContent ?? `Message #${m.messageId}`
    const outgoing = Boolean(session.accountAddress && addressesEqual(m.contributor, session.accountAddress))

    // Get sender nickname if available, fallback to address
    const senderAddress = m.contributor ?? ""
    const profile = profilesByAddress.value[senderAddress]
    // Key-sharing system notices always name the sender (nickname or address),
    // never "You" — even for the connected user's own key rotations.
    let senderLabel = profile?.nickname || formatAddress(senderAddress)
    if (m.tag !== keySharingTag && outgoing && !profile?.nickname) {
      senderLabel = "You"
    }

    const debugEntries: { key: string; value: string }[] = []
    debugEntries.push({ key: "ID", value: m.id })
    if (senderAddress) debugEntries.push({ key: "Sender", value: senderAddress })
    if (m.tag) debugEntries.push({ key: "Tag", value: m.tag })
    if (m.contentType) debugEntries.push({ key: "Content Type", value: m.contentType })
    if (m.reference) debugEntries.push({ key: "IPFS Ref", value: m.reference })
    // Show block number only in debug mode
    if (settings.showMessageDebug) {
      debugEntries.push({ key: "Block", value: formatBlock(m.createdBlock) })
    }

    // Use cached timestamp or fallback to block number for display
    // Lazy loading happens via watcher after initial render
    const timestampLabel = settings.showMessageDebug
      ? formatBlock(m.createdBlock)
      : (blockTimestamps.value[m.createdBlock] ?? formatBlock(m.createdBlock))

    return {
      id: m.id, body, outgoing,
      senderLabel,
      senderAddress, tag: m.tag ?? undefined,
      avatarUrl: outgoing ? undefined : avatarUrlByAddress.value[senderAddress],
      reference: m.reference ?? undefined,
      payloadError: payloadErrorById.value[m.id] ?? decryptErrorById.value[m.id],
      contentType: m.contentType ?? undefined,
      attachment: attachmentById.value[m.id],
      timestampLabel,
      debugEntries,
    }
  })
})

// ── Load everything via GraphQL ────────────────────────────────────
async function loadAll() {
  error.value = ""
  loading.value = true
  try {
    const url = indexerUrl.value
    if (!url) throw new Error("SubQuery indexer URL is not configured")
    const detail = await fetchIndexedBucketDetail(url, bucketId.value)
    if (!detail) { error.value = "Bucket not found in indexer"; return }
    bucket.value = detail.bucket
    admins.value = detail.admins
    contributors.value = detail.contributors
    viewers.value = detail.viewers
    messages.value = detail.messages

    // Namespace managers gate the setup timeline; a failed lookup must not break the page.
    try {
      namespaceManagers.value = detail.bucket.namespaceId != null
        ? (await fetchIndexedNamespaceManagers(url, String(detail.bucket.namespaceId))).map(m => m.manager)
        : []
    } catch {
      namespaceManagers.value = []
    }

    // 1. Fetch key-sharing messages by tag first
    const keySharingMessages = await fetchIndexedMessagesByTag(url, bucketId.value, keySharingTag)

    // 2. Hydrate their payloads so we can decrypt them
    await hydratePayloads(keySharingMessages)

    // 3. Decrypt all key-sharing messages (latest first) to find the active key
    await decryptKeySharingFromMessages(keySharingMessages)

    // 4. Now hydrate all remaining message payloads
    await hydratePayloads(detail.messages)

    // 5. Decrypt normal messages using the active key
    await decryptMessages(detail.messages)

    // 6. Resolve file attachments referenced by CID-pointer messages
    await hydrateAttachments(detail.messages)

    // 7. Resolve sender profile pictures for incoming messages
    await loadAvatars(detail.messages)
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load indexed data"
  } finally {
    loading.value = false
  }
}

// ── IPFS payload resolution ────────────────────────────────────────
function resolveUrl(ref: string): string {
  const t = ref.trim()
  if (/^https?:\/\//i.test(t)) return t
  return `${pinataGateway.value}/ipfs/${t}`
}

async function hydratePayloads(msgs: IndexedMessage[]) {
  const nextP: Record<string, string> = { ...payloadById.value }
  const nextE: Record<string, string> = { ...payloadErrorById.value }
  await Promise.all(msgs.map(async m => {
    if (nextP[m.id]) return // already hydrated
    if (m.ipfsContent) { nextP[m.id] = tryBase64Decode(m.ipfsContent) ?? m.ipfsContent; return }
    if (!m.reference) return
    try {
      const res = await fetch(resolveUrl(m.reference))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      nextP[m.id] = await res.text()
    } catch (e) {
      nextE[m.id] = e instanceof Error ? e.message : "Payload unavailable"
    }
  }))
  payloadById.value = nextP
  payloadErrorById.value = nextE
}

function tryBase64Decode(s: string): string | null {
  try { return atob(s) } catch { return null }
}

// ── Encryption / decryption helpers ────────────────────────────────
function isX25519Secret(v: unknown): v is jose.JWK {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false
  const c = v as Record<string, unknown>
  return c.kty === "OKP" && c.crv === "X25519" && typeof c.x === "string" && typeof c.d === "string"
}

function looksLikeCompactJwe(s: string): boolean {
  const p = s.split("."); return p.length === 5 && p.every(x => x.length > 0)
}

function parseJson(s: string): unknown { try { return JSON.parse(s) } catch { return undefined } }

async function decryptKeySharingFromMessages(keySharingMessages: IndexedMessage[]) {
  keySharingError.value = ""
  activeSecretJwk.value = null

  if (!keySharingMessages.length) {
    keySharingError.value = "No key-sharing message found"
    return
  }

  const secretJwk = settings.x25519SecretJwk
  if (!secretJwk) { keySharingError.value = "Load X25519 secret in sidebar to decrypt"; return }

  // Try from latest to earliest to find the most recent working key
  const reversed = [...keySharingMessages].reverse()
  for (const ksMsg of reversed) {
    const raw = payloadById.value[ksMsg.id]
    if (!raw?.trim()) continue

    try {
      const parsed = parseJson(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue
      const key = await jose.importJWK(secretJwk as jose.JWK, "ECDH-ES+A256KW")
      const { plaintext } = await jose.generalDecrypt(parsed as jose.GeneralJWE, key)
      const decoded = new TextDecoder().decode(plaintext)
      const inner = parseJson(decoded)
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        const keys = Array.isArray((inner as Record<string, unknown>).keys) ? (inner as Record<string, unknown>).keys as unknown[] : []
        for (const k of keys) { if (isX25519Secret(k)) { activeSecretJwk.value = { ...k, use: "enc" }; break } }
      }
      if (activeSecretJwk.value) return // found a working key
    } catch {
      // This key-sharing message didn't decrypt, try the next one
    }
  }

  keySharingError.value = "Could not decrypt any key-sharing message"
}

async function decryptMessages(msgs: IndexedMessage[]) {
  const nextD: Record<string, string> = {}
  const nextE: Record<string, string> = {}
  const sk = activeSecretJwk.value
  if (!sk || !isX25519Secret(sk)) { decryptedById.value = {}; decryptErrorById.value = {}; return }

  await Promise.all(msgs.map(async m => {
    if (m.tag === keySharingTag) return
    if (isFileMessage(m)) return
    const p = payloadById.value[m.id]
    if (!p) return
    const t = p.trim()
    if (!looksLikeCompactJwe(t)) { nextD[m.id] = p; return }
    try {
      const key = await jose.importJWK(sk as jose.JWK, "ECDH-ES+A256KW")
      const { plaintext } = await jose.compactDecrypt(t, key)
      nextD[m.id] = new TextDecoder().decode(plaintext)
    } catch (e) {
      nextE[m.id] = e instanceof Error ? e.message : "Decrypt failed"
      nextD[m.id] = p
    }
  }))
  decryptedById.value = nextD
  decryptErrorById.value = nextE
}

// ── File attachments (CID-pointer messages) ────────────────────────
const textMessageContentType = "text/plain;charset=utf-8"
const keySharingContentType = "application/didcomm-encrypted+json"

// A file message carries a real MIME contentType on-chain; its reference points at the encrypted file.
function isFileMessage(m: IndexedMessage): boolean {
  if (m.tag === keySharingTag) return false
  const ct = m.contentType?.trim()
  return Boolean(ct && ct !== textMessageContentType && ct !== keySharingContentType)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function hydrateAttachments(msgs: IndexedMessage[]) {
  const next: Record<string, ChatMessageAttachment> = { ...attachmentById.value }
  const nextE: Record<string, string> = { ...decryptErrorById.value }
  const sk = activeSecretJwk.value

  await Promise.all(msgs.map(async m => {
    if (next[m.id]) return
    if (!isFileMessage(m)) return
    const fileJwe = payloadById.value[m.id]?.trim()
    if (!fileJwe) return
    try {
      if (!sk || !isX25519Secret(sk)) throw new Error("No decrypted bucket key available. Decrypt key-sharing first.")
      if (!looksLikeCompactJwe(fileJwe)) throw new Error("File payload is not an encrypted attachment")
      const key = await jose.importJWK(sk as jose.JWK, "ECDH-ES+A256KW")
      const { plaintext, protectedHeader } = await jose.compactDecrypt(fileJwe, key)
      next[m.id] = {
        contentType: m.contentType?.trim() || "application/octet-stream",
        fileName: typeof protectedHeader.filename === "string" ? protectedHeader.filename : undefined,
        data: bytesToBase64(plaintext)
      }
    } catch (e) {
      nextE[m.id] = e instanceof Error ? e.message : "Attachment unavailable"
    }
  }))

  attachmentById.value = next
  decryptErrorById.value = nextE
}

// ── Sender avatars and profiles ────────────────────────────────────
async function loadAvatars(msgs: IndexedMessage[]) {
  // Incoming senders only: skip messages sent by the connected wallet.
  const incoming = msgs
    .map(m => m.contributor)
    .filter(addr => Boolean(addr) && !(session.accountAddress && addressesEqual(addr, session.accountAddress)))

  try {
    // Fetch both avatars and profile data (including nicknames)
    const uniqueAddresses = Array.from(new Set(incoming.filter(Boolean) as string[]))
    await Promise.all(uniqueAddresses.map(async addr => {
      try {
        const profile = await profileClient.getProfile(toSs58Prefix42(addr))
        if (profile) {
          profilesByAddress.value[addr] = profile
          if (profile.profilePicture) {
            avatarUrlByAddress.value[addr] = profile.profilePicture
          }
        }
      } catch {
        // Non-fatal: unresolved senders fall back to the default avatar.
      }
    }))
  } catch {
    // Non-fatal: unresolved senders fall back to the default avatar.
  }
}

// ── Send message (encrypted with latest key) ───────────────────────
async function encryptOutgoing(plaintext: Uint8Array | string, extraProtectedHeader?: Record<string, string>): Promise<string> {
  const sk = activeSecretJwk.value
  if (!sk || !isX25519Secret(sk)) {
    throw new Error("No decrypted bucket key available. Decrypt key-sharing first.")
  }

  const recipientPublicJwk: jose.JWK = {
    kty: "OKP", crv: "X25519", x: sk.x as string, use: "enc",
    kid: typeof sk.kid === "string" ? sk.kid : undefined
  }
  const publicKey = await jose.importJWK(recipientPublicJwk, "ECDH-ES+A256KW")
  const plaintextBytes = typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext
  return await new jose.CompactEncrypt(plaintextBytes)
    .setProtectedHeader({ alg: "ECDH-ES+A256KW", enc: "A256GCM", typ: "didcomm/encrypted-message-v1", kid: recipientPublicJwk.kid, ...extraProtectedHeader })
    .encrypt(publicKey)
}

function logExtrinsicUpdate(update: ExtrinsicUpdate): void {
  operations.add(
    "bucket_write",
    `buckets.write:${update.stage}`,
    update.stage === "error" ? "error" : "info",
    update.message
  )
}

function openFilePicker() {
  fileInputRef.value?.click()
}

function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const result = reader.result as string
    pendingAttachment.value = { file, dataUrl: result }
    sendText.value = "" // clear text — mutually exclusive
  }
  reader.readAsDataURL(file)
  input.value = ""
}

function removeAttachment() {
  pendingAttachment.value = null
}

async function sendMessage() {
  sendError.value = ""
  const textPayload = sendText.value.trim()
  const attachment = pendingAttachment.value

  if (!textPayload && !attachment) { sendError.value = "Enter a message or attach a file"; return }
  if (!session.accountAddress) { sendError.value = "Connect wallet before sending"; return }

  sending.value = true
  const savedText = sendText.value
  sendText.value = ""
  pendingAttachment.value = null
  try {
    let result
    if (attachment) {
      const fileContentType = attachment.file.type || "application/octet-stream"
      const fileBytes = new Uint8Array(await attachment.file.arrayBuffer())
      const fileJwe = await encryptOutgoing(fileBytes, { cty: fileContentType, filename: attachment.file.name })
      result = await didCommRepository.createFileMessage(
        bucketId.value, fileJwe, fileContentType, session.accountAddress, logExtrinsicUpdate
      )
    } else {
      const encrypted = await encryptOutgoing(textPayload)
      result = await didCommRepository.createMessage(
        bucketId.value, encrypted, session.accountAddress, logExtrinsicUpdate
      )
    }
    operations.add("bucket_write", result.method, "success", `Message submitted: ${result.txHash}`)
    await loadAll()
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : "Unable to send"
    if (!sendText.value) sendText.value = savedText
    if (attachment) pendingAttachment.value = attachment
  } finally {
    sending.value = false
  }
}

// ── Create & share bucket encryption key (setup timeline step 2) ───
function isHex32(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value)
}

function normalizeX25519Value(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed === "Not found") return undefined
  // Some chains return x25519 as hex; convert to JWK x (base64url)
  if (isHex32(trimmed)) return jose.base64url.encode(hexToU8a(trimmed))
  return trimmed
}

function randomNumericKeyId(): number {
  return Math.floor(Math.random() * 1_000_000_000_000)
}

function toWasmCompatibleSecretKey(secretJwk: jose.JWK): Record<string, string> {
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
  const readerAddresses = viewerRecipients.value.map(recipient => recipient.address)

  if (!readerAddresses.length) {
    throw new Error("No valid viewer X25519 keys are available for key sharing")
  }

  const recipientJwks: jose.JWK[] = [bucketPublicJwk]
  for (const recipient of viewerRecipients.value) {
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
    const recipientHeader: jose.JWEHeaderParameters = { alg: "ECDH-ES+A256KW" }
    if (typeof recipientJwk.kid === "string" && recipientJwk.kid.trim()) {
      recipientHeader.kid = recipientJwk.kid
    }

    encryptor.addRecipient(recipientJwk).setUnprotectedHeader(recipientHeader)
  }

  return await encryptor.encrypt()
}

async function createAndShareEncryptionKey(): Promise<void> {
  createKeyError.value = ""

  if (!session.accountAddress) {
    createKeyError.value = "Connect wallet before generating encryption keys"
    return
  }

  if (!canManageBucket.value) {
    createKeyError.value = "Only bucket admins and namespace managers can generate and distribute encryption keys"
    return
  }

  const namespaceId = bucket.value?.namespaceId != null ? String(bucket.value.namespaceId) : ""
  if (!namespaceId) {
    createKeyError.value = "Namespace id is required to rotate bucket encryption keys"
    return
  }

  creatingKey.value = true
  try {
    const { publicKey, privateKey } = await jose.generateKeyPair("ECDH-ES+A256KW", {
      crv: "X25519",
      extractable: true
    })

    const bucketPkJwk = await jose.exportJWK(publicKey)
    const bucketSkJwk = await jose.exportJWK(privateKey)

    const keyId = randomNumericKeyId().toString()
    bucketPkJwk.use = "enc"
    bucketSkJwk.use = "enc"
    bucketPkJwk.kid = keyId
    bucketSkJwk.kid = keyId

    const bucketEncryptionKey = typeof bucketPkJwk.x === "string" ? bucketPkJwk.x.trim() : ""
    if (!bucketEncryptionKey) {
      throw new Error("Generated public key is missing JWK.x and cannot be used for on-chain key rotation")
    }

    const { recipientJwks, readerAddresses } = buildRecipientJwks(bucketPkJwk)
    const keySharingMessage = buildKeySharingMessage(bucketSkJwk, readerAddresses)
    const plaintextBytes = new TextEncoder().encode(keySharingMessage)
    const jweObject = await encryptJweForMultipleRecipients(plaintextBytes, recipientJwks)

    const batchResult = await didCommRepository.rotateBucketKeyAndShare(
      namespaceId,
      bucketId.value,
      bucketEncryptionKey,
      keySharingTag,
      JSON.stringify(jweObject),
      session.accountAddress,
      logExtrinsicUpdate
    )

    operations.add(
      "bucket_write",
      batchResult.method,
      "success",
      `Bucket key rotated and shared via batchAll. keyId=${keyId}, tx=${batchResult.txHash}`
    )

    await loadAll()
  } catch (e) {
    createKeyError.value = e instanceof Error ? e.message : "Unable to rotate bucket encryption key"
    operations.add("bucket_write", "utility.batchAll", "error", createKeyError.value)
  } finally {
    creatingKey.value = false
  }
}

// ── Utility ────────────────────────────────────────────────────────
function summarize(payload: string): string | undefined {
  const p = parseJson(payload)
  if (!p || typeof p !== "object" || Array.isArray(p)) return undefined
  const r = p as Record<string, unknown>
  for (const k of ["message", "content", "payload", "body", "text", "summary"]) {
    if (typeof r[k] === "string" && r[k]) return r[k] as string
  }
  return JSON.stringify(r, null, 2)
}

function formatBlock(n: number): string { return `Block #${n.toLocaleString()}` }

// ── Lifecycle ──────────────────────────────────────────────────────
async function scrollToBottom() {
  await nextTick()
  const el = document.getElementById("chat-bottom-anchor")
  if (el) el.scrollIntoView({ behavior: "auto", block: "end" })
}

watch(() => chatMessages.value.length, () => scrollToBottom())
watch(() => settings.x25519SecretJwk, async () => {
  const url = indexerUrl.value
  if (!url) return
  const keySharingMessages = await fetchIndexedMessagesByTag(url, bucketId.value, keySharingTag)
  await hydratePayloads(keySharingMessages)
  await decryptKeySharingFromMessages(keySharingMessages)
  await decryptMessages(messages.value)
  await hydrateAttachments(messages.value)
}, { deep: true })

// Lazy load block timestamps when messages change
watch(messages, () => {
  lazyLoadBlockTimestamps()
}, { immediate: true })

onMounted(async () => {
  settings.initialize()
  await loadAll()
  await scrollToBottom()
})
</script>

<template>
  <div class="chat-page-container ib-custom-page">
    <!-- Header -->
    <header class="buckets-header ib-header-row">
      <div class="ib-container ib-header-inner">
        <div class="row ib-header-left">
          <div class="stack" style="gap: 2px">
            <h3 class="ib-title">{{ bucketDisplayName }}</h3>
          </div>
        </div>
        <div class="row ib-header-actions">
          <button class="btn" :disabled="loading" @click="loadAll">Reload</button>
          <NuxtLink class="btn" :to="`/messages/bucket/${encodeURIComponent(bucketId)}/info`">Info</NuxtLink>
        </div>
      </div>
    </header>

    <div class="ib-container">
      <LoadingBar v-if="loading" label="Querying SubQuery indexer..." style="flex-shrink:0;" />
      <p v-if="error" class="ib-error">{{ error }}</p>
    </div>

    <!-- Chat viewport -->
    <div class="ib-chat-viewport chat-viewport" role="log" aria-live="polite" aria-label="Indexed bucket messages">
      <div class="ib-container ib-chat-inner">
        <ChatMessageEntry v-for="msg in chatMessages" :key="msg.id" :message="msg" :show-avatars="true" />

        <!-- Empty bucket: setup timeline for admins / namespace managers -->
        <div v-if="showSetupTimeline" class="ib-setup-timeline">
          <div class="ib-setup-intro">
            <h4 class="ib-setup-title">Set up this bucket</h4>
            <p class="muted ib-setup-subtitle">No messages yet. Complete these steps to start the conversation.</p>
          </div>

          <ol class="ib-tl" aria-label="Bucket setup steps">
            <!-- Step 1: add members -->
            <li class="ib-tl-step" :class="keyStepActive ? 'is-complete' : 'is-active'">
              <div class="ib-tl-marker" aria-hidden="true">
                <Check v-if="keyStepActive" :size="16" />
                <span v-else>1</span>
              </div>
              <div class="card ib-tl-body">
                <div class="ib-tl-head">
                  <UserPlus :size="18" class="ib-tl-head-icon" />
                  <h5 class="ib-tl-step-title">Add members</h5>
                  <span class="ib-tl-count">{{ memberCount }} {{ memberCount === 1 ? "member" : "members" }} added</span>
                </div>
                <p class="muted ib-tl-desc">
                  Invite the people who should take part in this bucket. At least 2 members are needed
                  before an encryption key can be shared.
                </p>
                <NuxtLink class="btn btn-primary ib-tl-btn" :to="addMemberUrl">
                  <UserPlus :size="16" />
                  Add Members
                </NuxtLink>
              </div>
            </li>

            <!-- Step 2: create & share encryption key -->
            <li class="ib-tl-step" :class="keyStepActive ? 'is-active' : 'is-disabled'">
              <div class="ib-tl-marker" aria-hidden="true"><span>2</span></div>
              <div class="card ib-tl-body">
                <div class="ib-tl-head">
                  <KeyRound :size="18" class="ib-tl-head-icon" />
                  <h5 class="ib-tl-step-title">Create &amp; Share Encryption Key</h5>
                </div>
                <p class="muted ib-tl-desc">
                  Generates a fresh X25519 encryption keypair, stores the public key ID on-chain, and shares
                  the new secret key with all viewers using their X25519 keys.
                </p>
                <p v-if="!keyStepActive" class="muted ib-tl-hint">
                  Add at least 2 members to unlock this step.
                </p>
                <p v-else-if="!viewerRecipients.length" class="muted ib-tl-hint">
                  No viewer X25519 keys are available yet. Members must be added with the viewer role before
                  the key can be shared.
                </p>
                <button class="btn btn-primary ib-tl-btn" type="button"
                  :disabled="!keyStepActive || creatingKey || loading || !session.accountAddress || !viewerRecipients.length"
                  @click="createAndShareEncryptionKey">
                  <span v-if="creatingKey" class="ib-tl-btn-spinner" aria-hidden="true"></span>
                  <KeyRound v-else :size="16" />
                  {{ creatingKey ? "Creating & Sharing..." : "Create & Share Encryption Key" }}
                </button>
                <p v-if="createKeyError" class="ib-tl-error">{{ createKeyError }}</p>
              </div>
            </li>
          </ol>
        </div>

        <p v-else-if="!chatMessages.length && !loading" class="muted" style="text-align:center">
          No messages found for this bucket in the indexer.
        </p>

        <div id="chat-bottom-anchor"></div>
      </div>
    </div>

    <!-- Footer: conditional on wallet / contributor status -->

    <!-- (A) No wallet connected → Connect prompt -->
    <div v-if="!session.accountAddress" class="ib-footer-sticky">
      <div class="ib-container">
        <div class="ib-connect-prompt">
          <Wallet :size="20" class="ib-connect-prompt-icon" />
          <div class="ib-connect-prompt-text">
            <strong>Wallet not connected</strong>
            <span class="muted">Connect your wallet to participate in this bucket.</span>
          </div>
          <button class="btn btn-primary ib-connect-btn" type="button" @click="openWalletPopup">
            <Wallet :size="16" />
            Connect Wallet
          </button>
        </div>
      </div>
    </div>

    <!-- (B) Wallet connected but not admin/contributor -->
    <div v-else-if="!loading && !connectedAdminOrContributor" class="ib-footer-sticky">
      <div class="ib-container">
        <div class="ib-not-contributor">
          <ShieldAlert :size="20" class="ib-not-contributor-icon" />
          <div class="ib-not-contributor-text">
            <strong>Not a contributor</strong>
            <span class="muted">Your connected wallet is not a contributor to this bucket. Ask an admin to add you.</span>
          </div>
        </div>
      </div>
    </div>

    <!-- (C) Authorized → Message composer -->
    <div v-else class="ib-footer-sticky">
      <div class="ib-container">
        <input ref="fileInputRef" type="file" style="display:none" @change="onFileSelected" />
        <form class="ib-composer" @submit.prevent="sendMessage">
          <!-- Attachment mode: show file chip instead of textarea -->
          <template v-if="pendingAttachment">
            <div class="ib-attachment-chip">
              <Paperclip :size="16" class="ib-attachment-chip-icon" />
              <span class="ib-attachment-chip-name">{{ pendingAttachment.file.name }}</span>
              <button type="button" class="ib-attachment-chip-remove" @click="removeAttachment" title="Remove">
                <X :size="14" />
              </button>
            </div>
          </template>
          <!-- Text mode: textarea + attach button (attach hidden when typing) -->
          <template v-else>
            <button v-if="!sendText" type="button" class="ib-composer-attach" @click="openFilePicker"
              :disabled="sending || !activeSecretJwk" title="Attach file">
              <Paperclip :size="18" />
            </button>
            <textarea v-model="sendText" class="input ib-composer-input" name="message-text"
              placeholder="Write a message" rows="1" :disabled="sending" />
          </template>
          <button class="btn btn-primary ib-composer-send" type="submit"
            :disabled="sending || loading || !activeSecretJwk">
            <SendHorizontal :size="18" />
          </button>
        </form>
        <div class="ib-footer-meta">
          <p v-if="!activeSecretJwk && !loading" class="muted" style="margin:0; text-align:center; font-size:13px">
            Decrypt the bucket key to enable sending.
          </p>
          <p v-if="sendError" style="margin:0; color:var(--status-error); text-align:center; font-size:13px">
            {{ sendError }}
          </p>
        </div>
      </div>
    </div>

    <!-- Wallet selection popup (independent, not part of the footer chain) -->
    <div v-if="showWalletPopup" class="ib-wallet-overlay" @click.self="showWalletPopup = false">
      <div class="card stack ib-wallet-popup">
        <div class="row" style="justify-content: space-between; align-items: center">
          <h3 style="margin: 0">Select Wallet</h3>
          <button class="btn" type="button" aria-label="Close" @click="showWalletPopup = false"
            :disabled="selectingWallet">
            <X :size="14" />
          </button>
        </div>

        <LoadingBar v-if="loadingWalletAccounts" label="Loading wallets..." />

        <div v-else-if="walletAccounts.length" class="stack" style="max-height: 300px; overflow: auto; gap: 8px">
          <button v-for="account in walletAccounts" :key="account.address" class="btn" type="button"
            :disabled="selectingWallet"
            style="display: flex; justify-content: space-between; align-items: center; text-align: left"
            @click="selectWalletAccount(account.address)">
            <LoadingBar v-if="selectingWallet" label="" style="min-width: 0" />
            <span v-else class="stack" style="gap: 2px; min-width: 0; flex: 1">
              <strong>{{ account.name }}</strong>
              <span class="muted" style="font-size: 12px">{{ account.address.slice(0, 10) }}...{{
                account.address.slice(-10)
                }}</span>
            </span>
            <span class="muted" style="font-size: 12px; white-space: nowrap; margin-left: 8px">{{ account.source
              }}</span>
          </button>
        </div>

        <p v-else class="muted" style="margin: 0; min-height: 68px; display: flex; align-items: center; justify-content: center;">No wallets found.</p>
      </div>
    </div>
  </div>
</template>


<!-- Unscoped: override parent layout constraints when this page is active -->
<style>
.app-shell-content:has(.chat-page-container.ib-custom-page) {
  padding: 0;
  overflow: hidden;
  height: 100vh;
  min-height: 100vh;
}

.app-shell-root:has(.chat-page-container.ib-custom-page) {
  height: 100vh;
  overflow: hidden;
}

.app-shell-content>.container:has(.chat-page-container.ib-custom-page) {
  width: 100%;
  max-width: none;
  padding: 0;
  margin: 0;
  height: 100%;
  min-height: 0;
}

@supports (height: 100dvh) {
  .app-shell-content:has(.chat-page-container.ib-custom-page) {
    height: 100dvh;
    min-height: 100dvh;
  }

  .app-shell-root:has(.chat-page-container.ib-custom-page) {
    height: 100dvh;
  }
}

@media (max-width: 960px) {
  .app-shell-content:has(.chat-page-container.ib-custom-page) {
    padding-top: 56px;
    /* leave room for fixed topbar */
  }
}
</style>

<style scoped>
/* Main Full-Height Container */
.ib-custom-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #f7f8fa;
  overflow: hidden;
  position: relative;
}

.ib-container {
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
  padding: 0 48px;
}

.ib-header-row {
  background: transparent;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.ib-header-inner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 16px;
  padding-bottom: 16px;
}

.ib-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.ib-title {
  margin: 10px 0;
}

.ib-subtitle-text {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ib-source-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
  text-transform: uppercase;
}

.ib-header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.ib-error {
  color: var(--status-error);
  font-size: 14px;
}

/* Scrollable area for metadata panels */
.ib-content-scroll {
  flex-shrink: 0;
  max-height: 40vh;
  overflow-y: auto;
  padding: 8px 0;
  overscroll-behavior: contain;
}

/* Panels */
.ib-panel {
  margin: 0 0 8px;
  padding: 0;
  border-radius: 12px;
  box-shadow: none;
}

.ib-panel-summary {
  list-style: none;
  cursor: pointer;
  padding: 12px 16px;
  font-weight: 600;
  font-size: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  user-select: none;
  color: var(--text-primary);
}

.ib-panel-summary::-webkit-details-marker {
  display: none;
}

.ib-panel-toggle {
  font-size: 16px;
  color: var(--text-secondary);
  transition: transform 200ms;
}

.ib-panel[open] .ib-panel-toggle {
  transform: rotate(45deg);
}

.ib-panel-body {
  padding: 0 16px 16px;
}

.ib-meta {
  margin: 0;
  display: grid;
  gap: 6px;
}

.ib-meta-row {
  display: grid;
  grid-template-columns: minmax(110px, 180px) 1fr;
  gap: 8px;
  font-size: 13px;
  align-items: baseline;
}

.ib-meta-row dt {
  color: var(--text-secondary);
  font-weight: 600;
  margin: 0;
}

.ib-meta-row dd {
  color: var(--text-primary);
  margin: 0;
  word-break: break-all;
}

.mono {
  font-family: monospace;
  font-size: 12px;
}

.ib-section-label {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ib-member-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 4px;
}

.ib-member-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.7);
  font-size: 13px;
}

.ib-member-address {
  font-weight: 500;
  color: var(--text-primary);
  word-break: break-all;
  min-width: 0;
}

.ib-member-block {
  color: var(--text-secondary);
  font-size: 12px;
  flex-shrink: 0;
  margin-left: 8px;
}

/* Key status */
.ib-key-status {
  margin: 4px 0 8px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--status-warning) 8%, transparent);
  color: var(--status-warning);
  border: 1px solid color-mix(in srgb, var(--status-warning) 25%, transparent);
}

.ib-key-ok {
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
  color: var(--color-primary);
  border-color: color-mix(in srgb, var(--color-primary) 25%, transparent);
}

/* Chat Viewport: Matches reference chat-viewport */
.ib-chat-viewport {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: transparent;
  overscroll-behavior: contain;
  min-height: 0;
  -webkit-overflow-scrolling: touch;
}

.ib-chat-inner {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 32px;
  padding-bottom: 24px;
  flex: 1;
}

/* Sticky Footer / Composer */
.ib-footer-sticky {
  flex-shrink: 0;
  position: sticky;
  bottom: 0;
  margin-top: auto;
  padding: 10px 0 calc(14px + env(safe-area-inset-bottom));
  background: var(--surface-card);
  border-top: 1px solid var(--border-default);
  z-index: 50;
}

/* ── Connect-wallet prompt (variant A) ────────────────────────── */
.ib-connect-prompt {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-primary) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary) 20%, transparent);
}

.ib-connect-prompt-icon {
  flex-shrink: 0;
  color: var(--color-primary);
}

.ib-connect-prompt-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  min-width: 0;
}

.ib-connect-prompt-text strong {
  font-size: 14px;
  color: var(--text-primary);
}

/* ── Not-contributor notice (variant B) ───────────────────────── */
.ib-not-contributor {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--status-warning) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--status-warning) 25%, transparent);
}

.ib-not-contributor-icon {
  flex-shrink: 0;
  color: var(--status-warning);
}

.ib-not-contributor-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  min-width: 0;
}

.ib-not-contributor-text strong {
  font-size: 14px;
  color: var(--text-primary);
}

/* ── Composer (variant C) ─────────────────────────────────────── */
.ib-composer {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.ib-composer-input {
  flex: 1;
  min-height: 40px;
  max-height: 120px;
  border-radius: 999px;
  padding: 8px 14px;
  background: var(--surface-bg);
  border: 1px solid var(--border-default);
  resize: none;
  line-height: 22px;
  font-size: 14px;
  transition: border-color 150ms;
}

.ib-composer-input:focus {
  border-color: var(--color-primary);
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
}

.ib-composer-send {
  border-radius: 50%;
  width: 40px;
  height: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ib-composer-attach {
  background: none;
  border: 1px solid var(--border-default);
  border-radius: 50%;
  width: 40px;
  height: 40px;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-secondary);
  transition: border-color 150ms, color 150ms;
}

.ib-composer-attach:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.ib-attachment-chip {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  min-height: 40px;
  border-radius: 999px;
  background: var(--surface-bg);
  border: 1px solid var(--border-default);
  overflow: hidden;
}

.ib-attachment-chip-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.ib-attachment-chip-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.ib-attachment-chip-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: color 150ms, background 150ms;
}

.ib-attachment-chip-remove:hover {
  color: var(--status-error);
  background: rgba(0, 0, 0, 0.06);
}

.ib-footer-meta {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Connect button ─────────────────────────────────────────────── */
.ib-connect-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Empty-bucket setup timeline ────────────────────────────────── */
.ib-setup-timeline {
  width: 100%;
  max-width: 640px;
  margin: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 8px 0;
}

.ib-setup-intro {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: center;
}

.ib-setup-title {
  margin: 0;
  font-size: 18px;
}

.ib-setup-subtitle {
  margin: 0;
  font-size: 14px;
}

.ib-tl {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.ib-tl-step {
  position: relative;
  display: flex;
  gap: 16px;
  padding-bottom: 28px;
}

.ib-tl-step:last-child {
  padding-bottom: 0;
}

/* Vertical connector between step markers */
.ib-tl-step:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 15px;
  top: 32px;
  bottom: 0;
  width: 2px;
  background: var(--border-default);
}

.ib-tl-step.is-complete:not(:last-child)::before {
  background: color-mix(in srgb, var(--color-primary) 45%, transparent);
}

.ib-tl-marker {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  background: var(--surface-card);
  border: 2px solid var(--border-default);
  color: var(--text-secondary);
  z-index: 1;
}

.ib-tl-step.is-active .ib-tl-marker {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.ib-tl-step.is-complete .ib-tl-marker {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-white);
}

.ib-tl-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ib-tl-step.is-disabled .ib-tl-body {
  opacity: 0.65;
}

.ib-tl-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ib-tl-head-icon {
  flex-shrink: 0;
  color: var(--color-primary);
}

.ib-tl-step.is-disabled .ib-tl-head-icon {
  color: var(--text-secondary);
}

.ib-tl-step-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.ib-tl-count {
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 999px;
  white-space: nowrap;
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
}

.ib-tl-step.is-complete .ib-tl-count {
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
}

.ib-tl-desc,
.ib-tl-hint {
  margin: 0;
  font-size: 13px;
}

.ib-tl-error {
  margin: 0;
  font-size: 13px;
  color: var(--status-error);
}

.ib-tl-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.ib-tl-btn-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--color-white) 40%, transparent);
  border-top-color: var(--color-white);
  animation: ib-tl-spin 700ms linear infinite;
}

@keyframes ib-tl-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Wallet popup overlay ───────────────────────────────────────── */
.ib-wallet-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  display: grid;
  place-items: center;
  z-index: 100;
}

.ib-wallet-popup {
  width: min(560px, 92vw);
}



@media (max-width: 840px) {

  .ib-container {
    padding: 0 16px;
  }

  .ib-connect-prompt,
  .ib-not-contributor {
    flex-direction: column;
    text-align: center;
    padding: 16px;
  }

  .ib-tl-step {
    gap: 12px;
  }

  .ib-tl-marker {
    width: 28px;
    height: 28px;
    font-size: 13px;
  }

  .ib-tl-step:not(:last-child)::before {
    left: 13px;
    top: 28px;
  }

  .ib-tl-count {
    margin-left: 0;
    width: 100%;
    box-sizing: border-box;
    text-align: center;
  }

  .ib-tl-btn {
    align-self: stretch;
    justify-content: center;
    white-space: normal;
  }
}
</style>