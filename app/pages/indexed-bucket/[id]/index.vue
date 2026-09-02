<script setup lang="ts">
import type { ApiBucket, ApiMessage, OperationUpdate } from "../../../services/buckets/types"
import { isFileMessage, KEY_SHARING_MESSAGE_TAG, normalizeX25519ToJwkX } from "../../../services/buckets/valueCodecs"
import { ProfileClient } from "../../../services/profile/profileClient"
import { findViewersWithoutKeyAccess } from "../../../services/messages/keySharingCoverage"
import { latestKeySharingMessage, resolveKeyAccessState, type KeyAccessState } from "../../../services/messages/keyAccess"
import { withoutClaimedMessages } from "../../../services/messages/pendingMessageReconciliation"
import { connectBucketMessagesSocket, type BucketMessagesSocket } from "../../../services/buckets/bucketMessagesSocket"
import { createIncomingMessagePump } from "../../../services/messages/incomingMessagePump"
import { resolveAvatarUrls } from "../../../services/profile/avatarResolver"
import { normalizeApiAddress } from "../../../services/wallet/addressUtils"
import ParticleLoader from "../../../components/common/ParticleLoader.vue"
import PageHeader from "../../../components/common/PageHeader.vue"
import SubmitButton from "../../../components/common/SubmitButton.vue"
import type { SubmitButtonLabels } from "../../../components/common/submitButtonView"
import ChatMessageEntry, { type ChatMessageProps, type ChatMessageAttachment, type ChatMarketInfo } from "../../../components/common/ChatMessageEntry.vue"
import { Paperclip, X, SendHorizontal, Wallet, ShieldAlert, UserPlus, KeyRound, Check, HandCoins } from "lucide-vue-next"
import { useAddress } from "../../../composables/useAddress"
import { useWallet } from "../../../composables/useWallet"
import { useSubmitState } from "../../../composables/useSubmitState"
import { useAutoGrowTextarea } from "../../../composables/useAutoGrowTextarea"
import * as jose from "jose"
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue"
import { useRoute, useRuntimeConfig } from "nuxt/app"
import { useOperationsStore } from "../../../stores/operations"
import { useSessionStore } from "../../../stores/session"
import { useSettingsStore } from "../../../stores/settings"
import {
  REALXHUB_COUNTER_OFFER_TAG,
  REALXHUB_OFFER_TAG,
  REALXHUB_REFUSE_COUNTER_OFFER_TAG,
  REALXHUB_STATUS_TAG,
  SOLANA_TOKENS,
  DEFAULT_OFFER_TOKEN,
  isRealXhubCategory,
  isRealXhubTag,
  isValidPrice,
  priceToRawUnits,
  shortMint,
  formatPriceAmount,
  marketKindLabel,
  marketPayloadSummary,
  buildMarketPayload,
  parseMarketPayload,
  buildStatusPayload,
  parseStatusPayload,
  resolveMarketStatus,
  deriveActiveOffer,
  isMarketMessageSuperseded,
  tokenClusterLabel
} from "../../../services/buckets/realxhub"
import type {
  ActiveMarketOffer,
  MarketMessageEntry,
  MarketPayload,
  MarketStatus,
  SolanaToken,
  StatusPayload
} from "../../../services/buckets/realxhub"

const route = useRoute()
const config = useRuntimeConfig()
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

const bucketsRepository = useBucketsRepository()
const profileClient = new ProfileClient(String(config.public.profileApiUrl))

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
const bucket = ref<ApiBucket | null>(null)
const admins = ref<string[]>([])
const contributors = ref<string[]>([])
const viewers = ref<string[]>([])
const namespaceManagers = ref<string[]>([])
const messages = ref<ApiMessage[]>([])
const avatarUrlByAddress = ref<Record<string, string>>({})
const profilesByAddress = ref<Record<string, import("../../../types/profile").Profile>>({})

const payloadById = ref<Record<string, string>>({})
const payloadErrorById = ref<Record<string, string>>({})
const decryptedById = ref<Record<string, string>>({})
const decryptErrorById = ref<Record<string, string>>({})
const attachmentById = ref<Record<string, ChatMessageAttachment>>({})

// realXhub marketplace state — market + status messages are fetched by tag on
// top of the main message list, so the active offer survives page reloads.
const realxhubMarketMessages = ref<ApiMessage[]>([])
const realxhubStatusMessages = ref<ApiMessage[]>([])
const offerPopupOpen = ref(false)
const offerKind = ref<"offer" | "counterOffer">("offer")
const offerPrice = ref("")
const offerTokenMint = ref(DEFAULT_OFFER_TOKEN.mint)
const offerError = ref("")
const paymentNotice = ref(false)
const updatingRole = ref(false)

// Every bucket key we could recover from key-sharing messages, sorted
// chronologically. Messages are decrypted with the key of their era (the most
// recent key shared before them); sending always uses the latest key.
interface BucketKeyEntry {
  /** Id of the key-sharing message this key came out of. */
  id: string
  createdAt: string
  messageId: string
  jwk: jose.JWK
  key: Awaited<ReturnType<typeof jose.importJWK>>
}
// shallowRef: entries hold WebCrypto CryptoKey objects, which must not be
// wrapped in reactive proxies.
const bucketKeyEntries = shallowRef<BucketKeyEntry[]>([])
const activeSecretJwk = computed<jose.JWK | null>(() => {
  const entries = bucketKeyEntries.value
  return entries.length ? entries[entries.length - 1]!.jwk : null
})
const keySharingError = ref("")
const keySharingMessages = ref<ApiMessage[]>([])
// null = not yet checked (lazy, admins only); a number is the count of viewers
// whose X25519 key is missing from the latest key-sharing message.
const viewersMissingKeyCount = ref<number | null>(null)

// Whether the connected user can read the key the bucket is *currently* on.
// Decrypting some earlier key is not enough: sending with it would encrypt to a
// retired key nobody reads anymore. Gates the composer — see keyAccess.ts.
const keyAccessState = computed<KeyAccessState>(() => resolveKeyAccessState({
  hasSecret: Boolean(settings.x25519SecretJwk),
  keySharingMessages: keySharingMessages.value,
  decryptedIds: bucketKeyEntries.value.map(entry => entry.id)
}))

const keyAccessNotice = computed(() => {
  switch (keyAccessState.value) {
    case "no-key-shared":
      return {
        title: "No encryption key shared yet",
        detail: "An admin needs to create and share the bucket encryption key before messages can be sent."
      }
    case "no-secret":
      return {
        title: "Encryption key not loaded",
        detail: "Generate or load your X25519 encryption key in the sidebar to read and send messages in this bucket."
      }
    default:
      return {
        title: "You do not have access to the Encryption key.",
        detail: "Ask an admin to re-share it with you."
      }
  }
})

const sendText = ref("")
const sendError = ref("")
const sending = ref(false)
// True while the x25519-secret watch re-decrypts the whole history — a busy
// window for the incoming pump, like loading and sending.
const rekeying = ref(false)
const composerInputRef = ref<HTMLTextAreaElement | null>(null)
const chatViewportRef = ref<HTMLElement | null>(null)

// Grows the composer with the message up to the three-line cap in
// .ib-composer-input's max-height, after which it scrolls.
useAutoGrowTextarea(composerInputRef, () => sendText.value)

// ── Optimistic outgoing messages ───────────────────────────────────
// A pending message is rendered as a normal outgoing bubble whose timestamp
// slot shows the send status until it has been submitted and the page has
// reloaded to pick it up.
type PendingStatus = "signing" | "indexing" | "failed"

const pendingStatusLabels: Record<PendingStatus, string> = {
  signing: "signing…",
  indexing: "indexing…",
  failed: "failed"
}

interface PendingOutgoingMessage {
  id: string
  body: string
  attachment?: ChatMessageAttachment
  status: PendingStatus
  errorMessage?: string
  senderAddress: string
  /** Set once the write resolves — hides the server copy until this bubble goes. */
  serverId?: string
  tag?: string
  displayBody?: string
  market?: ChatMarketInfo
}

const pendingMessages = ref<PendingOutgoingMessage[]>([])
const {
  phase: keyPhase,
  errorMessage: createKeyError,
  applyUpdate: applyKeyUpdate,
  fail: failKey,
  reset: resetKey,
  run: runKey
} = useSubmitState()

// Two buttons drive this one operation: the "viewers are missing the key"
// warning and step 2 of the empty-bucket setup timeline. Same phase, different
// idle wording.
const keyWarningLabels: SubmitButtonLabels = {
  idle: "Regenerate encryption key",
  signing: "Signing…",
  submitting: "Sharing key…",
  success: "Key shared",
  error: "Key sharing failed — retry"
}
const keyTimelineLabels: SubmitButtonLabels = {
  ...keyWarningLabels,
  idle: "Create & share encryption key"
}
const pendingAttachment = ref<{ file: File; dataUrl: string } | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const bucketDisplayName = computed(() => bucket.value?.name || `Bucket ${bucketId.value}`)
const connectedAdmin = computed(() => {
  if (!session.accountAddress) return false
  return admins.value.some(a => addressesEqual(a, session.accountAddress!))
})
const connectedContributor = computed(() => {
  if (!session.accountAddress) return false
  return contributors.value.some(c => addressesEqual(c, session.accountAddress!))
})
const connectedAdminOrContributor = computed(() => connectedAdmin.value || connectedContributor.value)
const connectedNamespaceManager = computed(() => {
  if (!session.accountAddress) return false
  return namespaceManagers.value.some(m => addressesEqual(m, session.accountAddress!))
})
// A standalone bucket has no namespace, so the API lets its creator stand in
// for the namespace manager.
const connectedStandaloneCreator = computed(() => {
  if (!session.accountAddress || !bucket.value) return false
  return bucket.value.namespaceId == null && Boolean(bucket.value.creator)
    && addressesEqual(bucket.value.creator!, session.accountAddress!)
})
const canManageBucket = computed(() =>
  connectedAdmin.value || connectedNamespaceManager.value || connectedStandaloneCreator.value
)

// ── realXhub marketplace (offers, counter-offers, seller/buyer roles) ──
const isRealXhubBucket = computed(() => isRealXhubCategory(bucket.value?.category))

const orderedStatusPayloads = computed<StatusPayload[]>(() =>
  [...realxhubStatusMessages.value]
    .sort((a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) || Number(a.messageId) - Number(b.messageId)
    )
    .map(m => parseStatusPayload(decryptedById.value[m.id] ?? payloadById.value[m.id] ?? ""))
    .filter((p): p is StatusPayload => p !== undefined)
)

// Marketplace role of the connected wallet: admins default to seller, every
// contributor to buyer; a later encrypted status message overrides the default.
const myStatus = computed<MarketStatus | null>(() => {
  if (!isRealXhubBucket.value || !session.accountAddress) return null
  const role = connectedAdmin.value ? "admin" : "contributor"
  return resolveMarketStatus(session.accountAddress, role, orderedStatusPayloads.value)
})

const marketEntries = computed<MarketMessageEntry[]>(() =>
  realxhubMarketMessages.value
    .map(m => {
      const payload = parseMarketPayload(decryptedById.value[m.id] ?? payloadById.value[m.id] ?? "")
      return payload ? { message: m, payload } : null
    })
    .filter((e): e is MarketMessageEntry => e !== null)
)

// The newest offer / counter-offer is the only active one; a refusal clears it.
const activeMarket = computed<ActiveMarketOffer | null>(() => deriveActiveOffer(marketEntries.value))
const activeMarketIsMine = computed(
  () =>
    Boolean(
      activeMarket.value &&
        session.accountAddress &&
        addressesEqual(activeMarket.value.message.contributor, session.accountAddress)
    )
)
const offerToken = computed<SolanaToken>(
  () => SOLANA_TOKENS.find(t => t.mint === offerTokenMint.value) ?? DEFAULT_OFFER_TOKEN
)

// Sellers and buyers for the admin role panel (admins first, deduped).
const realxhubRoleMembers = computed(() => {
  const seen = new Set<string>()
  const out: { address: string; role: "admin" | "contributor"; status: MarketStatus }[] = []
  for (const role of ["admin", "contributor"] as const) {
    for (const address of role === "admin" ? admins.value : contributors.value) {
      if (seen.has(address)) continue
      seen.add(address)
      out.push({ address, role, status: resolveMarketStatus(address, role, orderedStatusPayloads.value) })
    }
  }
  return out
})

// ── Empty-bucket setup timeline ────────────────────────────────────
const memberCount = computed(() => {
  const unique = new Set<string>()
  for (const member of [...admins.value, ...contributors.value]) unique.add(member)
  return unique.size
})

// Viewers are keyed on-chain by their X25519 key, so the identifier itself is the key.
const viewerRecipients = computed(() => {
  return viewers.value.flatMap(viewerKey => {
    const x25519 = normalizeX25519ToJwkX(viewerKey)
    return x25519 ? [{ address: viewerKey, x25519 }] : []
  })
})

const keyStepActive = computed(() => memberCount.value >= 2)
const showSetupTimeline = computed(() =>
  !loading.value && !error.value && Boolean(bucket.value) && !messages.value.length
  && !pendingMessages.value.length && canManageBucket.value
)

const addMemberUrl = computed(() => {
  const namespaceId = bucket.value?.namespaceId != null ? String(bucket.value.namespaceId) : ""
  return `/messages/bucket/add-member/${encodeURIComponent(bucketId.value)}?namespaceId=${encodeURIComponent(namespaceId)}`
})

// ── Chat message rendering ─────────────────────────────────────────
// While loadAll is hydrating and decrypting payloads the chat area shows a
// full-height loader instead of messages — otherwise bubbles render with raw
// JWE bodies until decryption catches up. Suppressed while optimistic pending
// bubbles are on screen: the post-send reload must not blank the conversation.
const showChatLoading = computed(() => loading.value && !pendingMessages.value.length)

const chatMessages = computed<ChatMessageProps[]>(() => {
  // Sort messages chronologically so oldest is at the top, newest at the bottom.
  // Messages an in-flight pending bubble already stands in for are held back so
  // the two never render side by side (see pendingMessageReconciliation).
  const visibleMessages = withoutClaimedMessages(messages.value, pendingMessages.value)

  // realXhub marketplace messages arrive via dedicated tag fetches and are
  // merged in when they are not part of the main list yet.
  const taggedExtras = isRealXhubBucket.value
    ? realxhubMarketMessages.value.filter((m) => !visibleMessages.some((x) => x.id === m.id))
    : []

  const sortedMessages = [...visibleMessages, ...taggedExtras].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || Number(a.messageId) - Number(b.messageId),
  )

  const rawEntries = sortedMessages.map((m): ChatMessageProps | null => {
    // Role-status messages feed the roles panel, not the chat.
    if (m.tag === REALXHUB_STATUS_TAG) return null

    const payload = decryptedById.value[m.id] ?? payloadById.value[m.id]
    const payloadBody = payload ? summarize(payload) ?? payload : undefined
    const marketPayload = parseMarketPayload(payload ?? "")
    // Market payloads render as a card — keep the JSON body out of the bubble.
    const baseBody = (marketPayload ? undefined : payloadBody) ?? m.description ?? m.ipfsContent ?? `Message #${m.messageId}`
    const body = marketPayload?.kind === "refuse" ? marketPayloadSummary(marketPayload) : baseBody
    const outgoing = Boolean(session.accountAddress && addressesEqual(m.contributor, session.accountAddress))

    let market: ChatMarketInfo | undefined
    if (marketPayload && marketPayload.kind !== "refuse" && marketPayload.token) {
      market = {
        kind: marketPayload.kind,
        price: marketPayload.price ?? "",
        token: {
          cluster: marketPayload.token.cluster,
          mint: marketPayload.token.mint,
          symbol: marketPayload.token.symbol,
          decimals: marketPayload.token.decimals,
        },
        superseded: isMarketMessageSuperseded(marketEntries.value, m),
      }
    }

    // Key-sharing system notices always name the sender — by profile nickname
    // when there is one, otherwise the address — never "You", even for the
    // connected user's own key rotations.
    const senderAddress = m.contributor ?? ""
    const profile = profilesByAddress.value[senderAddress]
    const senderLabel = m.tag !== KEY_SHARING_MESSAGE_TAG && outgoing
      ? "You"
      : profile?.nickname || formatAddress(senderAddress)

    const debugEntries: { key: string; value: string }[] = []
    debugEntries.push({ key: "ID", value: m.id })
    if (senderAddress) debugEntries.push({ key: "Sender", value: senderAddress })
    if (m.tag) debugEntries.push({ key: "Tag", value: m.tag })
    if (m.contentType) debugEntries.push({ key: "Content Type", value: m.contentType })
    if (m.reference) debugEntries.push({ key: "IPFS Ref", value: m.reference })
    // Show the raw createdAt only in debug mode
    if (settings.showMessageDebug) {
      debugEntries.push({ key: "Created At", value: m.createdAt })
    }

    const timestampLabel = new Date(m.createdAt).toLocaleString()

    return {
      id: m.id, body, outgoing,
      senderLabel,
      senderAddress, tag: m.tag ?? undefined,
      avatarUrl: outgoing ? undefined : avatarUrlByAddress.value[senderAddress],
      reference: m.reference ?? undefined,
      payloadError: payloadErrorById.value[m.id] ?? decryptErrorById.value[m.id],
      // Decrypt failures only — a payload that never loaded keeps the plain
      // warning line, since there is no ciphertext to hide.
      decryptFailed: Boolean(decryptErrorById.value[m.id]),
      contentType: m.contentType ?? undefined,
      attachment: attachmentById.value[m.id],
      market,
      timestampLabel,
      debugEntries,
    }
  })

  const entries = rawEntries.filter((e): e is ChatMessageProps => e !== null)

  // Optimistic in-flight messages sit at the bottom, newest last. They stay in
  // `pendingMessages` until the reload that follows their submit call has
  // hydrated the real message; the server copy is suppressed until then.
  for (const p of pendingMessages.value) {
    entries.push({
      id: p.id,
      body: p.displayBody ?? p.body,
      outgoing: true,
      senderLabel: "You",
      senderAddress: p.senderAddress,
      attachment: p.attachment,
      market: p.market,
      timestampLabel: pendingStatusLabels[p.status],
      pending: true,
      failed: p.status === "failed",
      payloadError: p.errorMessage
    })
  }

  return entries
})

// ── Load everything ────────────────────────────────────────────────
async function loadAll() {
  error.value = ""
  loading.value = true
  try {
    // The busy window is open, so no new live apply can start — but one may be
    // mid-flight, and its map merges would land on top of the reload's state.
    // Let it drain before snapshotting anything.
    await incomingPump.idle()
    const detail = await bucketsRepository.fetchBucketDetail(bucketId.value)
    if (!detail) { error.value = "Bucket not found"; return }
    bucket.value = detail.bucket
    admins.value = detail.admins
    contributors.value = detail.contributors
    viewers.value = detail.viewers
    messages.value = detail.messages

    // Namespace managers gate the setup timeline; a failed lookup must not break the page.
    try {
      namespaceManagers.value = detail.bucket.namespaceId
        ? await bucketsRepository.fetchNamespaceManagers(detail.bucket.namespaceId)
        : []
    } catch {
      namespaceManagers.value = []
    }

    // 0. realXhub marketplace + role-status messages live under their own tags
    if (isRealXhubBucket.value) {
      const [realxhubOffers, realxhubCounters, realxhubRefuses, realxhubStatuses] = await Promise.all([
        bucketsRepository.fetchMessagesByTag(bucketId.value, REALXHUB_OFFER_TAG),
        bucketsRepository.fetchMessagesByTag(bucketId.value, REALXHUB_COUNTER_OFFER_TAG),
        bucketsRepository.fetchMessagesByTag(bucketId.value, REALXHUB_REFUSE_COUNTER_OFFER_TAG),
        bucketsRepository.fetchMessagesByTag(bucketId.value, REALXHUB_STATUS_TAG),
      ])
      realxhubMarketMessages.value = [...realxhubOffers, ...realxhubCounters, ...realxhubRefuses]
      realxhubStatusMessages.value = realxhubStatuses
      // Hydrate now; decryption runs in step 5 once the active key is known.
      const freshTagged = [...realxhubMarketMessages.value, ...realxhubStatusMessages.value].filter(
        (m) => !detail.messages.some((x) => x.id === m.id),
      )
      if (freshTagged.length) await hydratePayloads(freshTagged)
    }

    // 1. Fetch key-sharing messages by tag first
    keySharingMessages.value = await bucketsRepository.fetchMessagesByTag(bucketId.value, KEY_SHARING_MESSAGE_TAG)
    viewersMissingKeyCount.value = null // data changed — the lazy viewer check must re-run

    // 2. Hydrate their payloads so we can decrypt them
    await hydratePayloads(keySharingMessages.value)

    // 3. Decrypt all key-sharing messages (latest first) to find the active key
    await decryptKeySharingFromMessages(keySharingMessages.value)

    // 4. Now hydrate all remaining message payloads
    await hydratePayloads(detail.messages)

    // 5. Decrypt normal messages using the active key (realXhub marketplace
    // and role-status payloads ride the same bucket key)
    await decryptMessages(detail.messages)
    if (isRealXhubBucket.value) {
      await decryptMessages([...realxhubMarketMessages.value, ...realxhubStatusMessages.value])
    }

    // 6. Resolve file attachments referenced by CID-pointer messages
    await hydrateAttachments(detail.messages)

    // 7. Resolve sender profiles (nicknames + pictures) for every message sender
    await loadSenderProfiles([
      ...detail.messages,
      ...keySharingMessages.value,
      ...realxhubMarketMessages.value,
      ...realxhubStatusMessages.value,
    ])
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load indexed data"
  } finally {
    loading.value = false
    // Live messages that arrived during the reload were held back — apply them
    // now that the wholesale state replacement is over.
    incomingPump.flush()
  }
}

// ── IPFS payload resolution ────────────────────────────────────────
function resolveUrl(ref: string): string {
  const t = ref.trim()
  if (/^https?:\/\//i.test(t)) return t
  return `${pinataGateway.value}/ipfs/${t}`
}

async function hydratePayloads(msgs: ApiMessage[]) {
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

async function decryptKeySharingFromMessages(keySharingMessages: ApiMessage[]) {
  keySharingError.value = ""

  if (!keySharingMessages.length) {
    bucketKeyEntries.value = []
    keySharingError.value = "No key-sharing message found"
    return
  }

  const secretJwk = settings.x25519SecretJwk
  if (!secretJwk) {
    bucketKeyEntries.value = []
    keySharingError.value = "Load X25519 secret in sidebar to decrypt"
    return
  }

  // Decrypt every key-sharing message we can: rotations replace the bucket
  // key, so older messages need the older keys.
  const readerKey = await jose.importJWK(secretJwk as jose.JWK, "ECDH-ES+A256KW")
  const entries: BucketKeyEntry[] = []

  await Promise.all(keySharingMessages.map(async ksMsg => {
    const raw = payloadById.value[ksMsg.id]
    if (!raw?.trim()) return

    try {
      const parsed = parseJson(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
      const { plaintext } = await jose.generalDecrypt(parsed as jose.GeneralJWE, readerKey)
      const decoded = new TextDecoder().decode(plaintext)
      const inner = parseJson(decoded)
      if (!inner || typeof inner !== "object" || Array.isArray(inner)) return
      const keys = Array.isArray((inner as Record<string, unknown>).keys) ? (inner as Record<string, unknown>).keys as unknown[] : []
      for (const k of keys) {
        if (isX25519Secret(k)) {
          const jwk: jose.JWK = { ...k, use: "enc" }
          entries.push({
            id: ksMsg.id,
            createdAt: ksMsg.createdAt,
            messageId: ksMsg.messageId,
            jwk,
            key: await jose.importJWK(jwk, "ECDH-ES+A256KW")
          })
          break
        }
      }
    } catch {
      // Not addressed to us (e.g. shared before we became a viewer) — skip.
    }
  }))

  entries.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || Number(a.messageId) - Number(b.messageId))
  // Single assignment at the end — never clear-then-rebuild: readers like the
  // composer's key-access gate must not observe a half-built key set.
  bucketKeyEntries.value = entries

  if (!entries.length) {
    keySharingError.value = "Could not decrypt any key-sharing message"
  }
}

// The key that was current when the message was written: the most recent
// key-sharing entry strictly before it (by createdAt, then on-chain messageId
// for same-timestamp ordering). Falls back to the earliest known key for
// messages older than anything we could decrypt.
function keyEntryForMessage(m: ApiMessage): BucketKeyEntry | null {
  const entries = bucketKeyEntries.value
  let match: BucketKeyEntry | null = null
  for (const entry of entries) {
    const sharedBefore = Date.parse(entry.createdAt) < Date.parse(m.createdAt)
      || (entry.createdAt === m.createdAt && Number(entry.messageId) < Number(m.messageId))
    if (sharedBefore) match = entry
  }
  return match ?? entries[0] ?? null
}

// Decrypts with the message's era key first, then falls back to the remaining
// keys (newest first) — defensive against share/rotation edge cases.
async function decryptCompactWithEraKey(m: ApiMessage, compactJwe: string): Promise<jose.CompactDecryptResult> {
  const entries = bucketKeyEntries.value
  const primary = keyEntryForMessage(m)
  const candidates: BucketKeyEntry[] = primary ? [primary] : []
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!
    if (entry !== primary) candidates.push(entry)
  }

  let lastError: unknown = new Error("No decrypted bucket key available. Decrypt key-sharing first.")
  for (const candidate of candidates) {
    try {
      return await jose.compactDecrypt(compactJwe, candidate.key)
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Decrypt failed")
}

// Merges into the existing maps rather than replacing them, so it can be
// called with just the messages that changed (a live socket message, a key
// rotation's re-decrypt) without wiping everything already decrypted.
async function decryptMessages(msgs: ApiMessage[]) {
  const nextD: Record<string, string> = { ...decryptedById.value }
  const nextE: Record<string, string> = { ...decryptErrorById.value }
  if (!bucketKeyEntries.value.length) {
    // No usable keys: clear plaintext and errors for these messages only.
    // Entries for other ids — attachment errors especially, which belong to
    // hydrateAttachments — must survive a partial-list call.
    for (const m of msgs) { delete nextD[m.id]; delete nextE[m.id] }
    decryptedById.value = nextD
    decryptErrorById.value = nextE
    return
  }

  await Promise.all(msgs.map(async m => {
    if (m.tag === KEY_SHARING_MESSAGE_TAG) return
    if (isFileMessage(m)) return
    const p = payloadById.value[m.id]
    if (!p) return
    const t = p.trim()
    if (!looksLikeCompactJwe(t)) { nextD[m.id] = p; delete nextE[m.id]; return }
    try {
      const { plaintext } = await decryptCompactWithEraKey(m, t)
      nextD[m.id] = new TextDecoder().decode(plaintext)
      // A key that arrived later may have unlocked an earlier failure.
      delete nextE[m.id]
    } catch (e) {
      nextE[m.id] = e instanceof Error ? e.message : "Decrypt failed"
      nextD[m.id] = p
    }
  }))
  decryptedById.value = nextD
  decryptErrorById.value = nextE
}

// ── File attachments (CID-pointer messages) ────────────────────────
// isFileMessage is imported from services/buckets/valueCodecs.

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function hydrateAttachments(msgs: ApiMessage[]) {
  const next: Record<string, ChatMessageAttachment> = { ...attachmentById.value }
  const nextE: Record<string, string> = { ...decryptErrorById.value }

  await Promise.all(msgs.map(async m => {
    if (next[m.id]) return
    if (!isFileMessage(m)) return
    const fileJwe = payloadById.value[m.id]?.trim()
    if (!fileJwe) return
    try {
      if (!looksLikeCompactJwe(fileJwe)) throw new Error("File payload is not an encrypted attachment")
      const { plaintext, protectedHeader } = await decryptCompactWithEraKey(m, fileJwe)
      next[m.id] = {
        contentType: m.contentType?.trim() || "application/octet-stream",
        fileName: typeof protectedHeader.filename === "string" ? protectedHeader.filename : undefined,
        data: bytesToBase64(plaintext)
      }
      // A retry that succeeded (e.g. after a key rotation) clears its old error.
      delete nextE[m.id]
    } catch (e) {
      nextE[m.id] = e instanceof Error ? e.message : "Attachment unavailable"
    }
  }))

  attachmentById.value = next
  decryptErrorById.value = nextE
}

// ── Sender avatars and profiles ────────────────────────────────────
// Resolves every sender, including the connected wallet: key-sharing notices
// name their sender by nickname even when that sender is you. Avatars are only
// rendered for incoming messages, so the extra own-profile lookup costs one
// request and nothing else.
async function loadSenderProfiles(msgs: ApiMessage[]) {
  const senders = Array.from(new Set(
    msgs.map(m => m.contributor).filter((addr): addr is string => Boolean(addr))
  ))

  await Promise.all(senders.map(async addr => {
    try {
      const profile = await profileClient.getProfile(normalizeApiAddress(addr))
      if (!profile) return
      profilesByAddress.value[addr] = profile
      if (profile.profilePicture) {
        avatarUrlByAddress.value[addr] = profile.profilePicture
      }
    } catch {
      // Non-fatal: unresolved senders fall back to the address and default avatar.
    }
  }))
}

// ── Live updates over the profile API's Socket.IO endpoint ─────────
// The realtime API only delivers messages written while the connection is up
// (at-most-once, no history, no replay), so loadAll stays the source of
// history and the socket replaces manual reloads for new messages.
function isKnownMessageId(id: string): boolean {
  return messages.value.some(m => m.id === id)
    || keySharingMessages.value.some(m => m.id === id)
    || realxhubMarketMessages.value.some(m => m.id === id)
    || realxhubStatusMessages.value.some(m => m.id === id)
}

// Runs the per-message slice of loadAll's pipeline for one live message.
// Serialized by the pump, so the map merges in these steps never interleave.
async function applyIncomingMessage(m: ApiMessage): Promise<void> {
  if (isKnownMessageId(m.id)) return

  if (m.tag === KEY_SHARING_MESSAGE_TAG) {
    // A key rotation landed while the page is open. Decrypt the new key BEFORE
    // publishing the message: keyAccessState reads both keySharingMessages and
    // the decrypted key entries, and publishing first would flash "no access"
    // (unmounting the composer mid-typing) until the decrypt caught up.
    const nextKeySharing = [...keySharingMessages.value, m]
    await hydratePayloads([m])
    await decryptKeySharingFromMessages(nextKeySharing)
    // Key-sharing messages live in both lists: `messages` renders the system
    // notice, `keySharingMessages` feeds key recovery.
    keySharingMessages.value = nextKeySharing
    messages.value = [...messages.value, m]
    // The new key may unlock messages and attachments whose decrypt failed
    // under the previous key set.
    await decryptMessages(messages.value)
    await hydrateAttachments(messages.value)
    await loadSenderProfiles([m])
    viewersMissingKeyCount.value = null
    if (connectedAdmin.value) void checkViewerKeyAccess()
    return
  }

  // realXhub marketplace / role-status messages carry their own tags and may
  // not be part of the generic message fetch — route them into the tagged lists.
  if (isRealXhubTag(m.tag)) {
    const list = m.tag === REALXHUB_STATUS_TAG ? realxhubStatusMessages : realxhubMarketMessages
    list.value = [...list.value, m]
    await hydratePayloads([m])
    await decryptMessages([m])
    await loadSenderProfiles([m])
    return
  }

  messages.value = [...messages.value, m]
  await hydratePayloads([m])
  await decryptMessages([m])
  await hydrateAttachments([m])
  await loadSenderProfiles([m])
}

const incomingPump = createIncomingMessagePump<ApiMessage>({
  isBusy: () => loading.value || sending.value || rekeying.value,
  apply: applyIncomingMessage,
  onError: (e, m) => console.warn(`Failed to apply live message ${m.id}`, e)
})

// Delivery starts only from the subscription and has no replay, so every
// successful subscribe triggers a reconciliation fetch: unknown messages go
// through the same pipeline as live events (the pump deduplicates). Bumped
// on each subscribe and on unmount to cancel superseded retries.
let catchUpGeneration = 0

async function catchUpMissedMessages(attempt = 0): Promise<void> {
  const generation = catchUpGeneration
  try {
    const all = await bucketsRepository.fetchMessages(bucketId.value)
    if (generation !== catchUpGeneration) return
    for (const m of all) incomingPump.push(m)
  } catch (e) {
    if (generation !== catchUpGeneration) return
    if (attempt < 2) {
      setTimeout(() => {
        if (generation === catchUpGeneration) void catchUpMissedMessages(attempt + 1)
      }, (attempt + 1) * 5000)
      return
    }
    // Out of retries: the chat may be missing messages — say so instead of
    // staying silently stale. Any later reload clears the notice.
    console.warn("Failed to catch up messages after reconnect", e)
    error.value = "Live updates may be behind — press Reload to refresh."
  }
}

let messagesSocket: BucketMessagesSocket | null = null

function connectMessagesSocket(): void {
  messagesSocket = connectBucketMessagesSocket(
    String(config.public.profileApiUrl),
    bucketId.value,
    {
      onMessage: m => incomingPump.push(m),
      // Fires on the first connect too: the initial loadAll races the
      // subscription, and this fetch reconciles anything written in between.
      onSubscribed: () => {
        catchUpGeneration += 1
        void catchUpMissedMessages()
      },
      // Non-fatal: the page still works read-on-load; Reload stays available.
      onSubscribeError: e => console.warn(`Bucket subscription refused: ${e.code} ${e.message}`)
    }
  )
}

onUnmounted(() => {
  catchUpGeneration += 1
  messagesSocket?.close()
  messagesSocket = null
})

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

function updatePendingStatus(id: string, status: PendingStatus): void {
  const entry = pendingMessages.value.find(p => p.id === id)
  if (entry) entry.status = status
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Signs and submits a pending entry's payload. On failure the entry stays in
// the chat as "failed" with Retry/Discard actions instead of being dropped.
// The buckets API is synchronous, so a resolved call means the message is
// already readable — reload and drop the pending bubble immediately.
async function submitPending(pending: PendingOutgoingMessage): Promise<void> {
  sending.value = true

  const onOperationUpdate = (update: OperationUpdate): void => {
    if (update.stage === "error") updatePendingStatus(pending.id, "failed")
  }

  try {
    let result
    if (pending.attachment) {
      const fileBytes = base64ToBytes(pending.attachment.data)
      const fileJwe = await encryptOutgoing(fileBytes, {
        cty: pending.attachment.contentType,
        filename: pending.attachment.fileName ?? "attachment"
      })
      result = await bucketsRepository.createFileMessage(
        bucketId.value, fileJwe, pending.attachment.contentType, pending.senderAddress, onOperationUpdate
      )
    } else {
      // realXhub marketplace messages are created under their dedicated tag
      if (pending.tag) await ensureRealXhubTag(pending.tag)
      const encrypted = await encryptOutgoing(pending.body)
      result = await bucketsRepository.createMessage(
        bucketId.value, encrypted, pending.senderAddress, onOperationUpdate, pending.tag
      )
    }
    operations.add("bucket_write", "Send message", "success", `Message submitted: ${result.id}`)
    // The API is synchronous: once the call resolves the message is already
    // readable, so advance straight to "indexing", reload, and drop the bubble.
    // Claiming the returned id keeps the reloaded server copy hidden until this
    // bubble goes away, so the message never appears twice.
    const entry = pendingMessages.value.find(p => p.id === pending.id)
    if (entry) {
      entry.serverId = result.id
      entry.status = "indexing"
    }
    await loadAll()
    pendingMessages.value = pendingMessages.value.filter(p => p.id !== pending.id)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unable to send"
    const entry = pendingMessages.value.find(p => p.id === pending.id)
    if (entry) {
      entry.status = "failed"
      entry.errorMessage = message
      // Failed bubbles stay on screen until retried or discarded — never let
      // one keep suppressing a server message.
      entry.serverId = undefined
    }
    operations.add("bucket_write", "Send message", "error", message)
  } finally {
    sending.value = false
    // Live messages held back during the send (including our own echo from
    // the socket) reconcile now — already-loaded ids are dropped by the pump's
    // apply, so nothing renders twice.
    incomingPump.flush()
  }
}

async function sendMessage() {
  sendError.value = ""
  const textPayload = sendText.value.trim()
  const attachment = pendingAttachment.value

  if (!textPayload && !attachment) { sendError.value = "Enter a message or attach a file"; return }
  if (!session.accountAddress) { sendError.value = "Connect wallet before sending"; return }

  sendText.value = ""
  pendingAttachment.value = null

  const pending: PendingOutgoingMessage = {
    id: `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    body: attachment ? "" : textPayload,
    attachment: attachment
      ? {
          contentType: attachment.file.type || "application/octet-stream",
          fileName: attachment.file.name,
          // readAsDataURL always yields "data:<type>;base64,<data>"
          data: attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1)
        }
      : undefined,
    status: "signing",
    senderAddress: session.accountAddress
  }
  pendingMessages.value = [...pendingMessages.value, pending]

  await submitPending(pending)
}

async function retryFailedMessage(id: string): Promise<void> {
  const entry = pendingMessages.value.find(p => p.id === id)
  if (!entry || entry.status !== "failed" || sending.value) return
  entry.status = "signing"
  entry.errorMessage = undefined
  entry.serverId = undefined
  await submitPending(entry)
}

function discardFailedMessage(id: string): void {
  const entry = pendingMessages.value.find(p => p.id === id)
  if (!entry || entry.status !== "failed") return
  pendingMessages.value = pendingMessages.value.filter(p => p.id !== id)
}

// ── realXhub marketplace actions ─────────────────────────────────────
const ensuredRealXhubTags = new Set<string>()

// Create the bucket tag once before sending; a duplicate or failed ensure
// must never block the message itself.
async function ensureRealXhubTag(tag: string): Promise<void> {
  if (ensuredRealXhubTags.has(tag) || !session.accountAddress) return
  try {
    await bucketsRepository.createTag(bucketId.value, tag, session.accountAddress)
  } catch {
    // Tag may already exist or the API may be unavailable — sending still proceeds.
  }
  ensuredRealXhubTags.add(tag)
}

function openOfferPopup(kind: "offer" | "counterOffer"): void {
  offerKind.value = kind
  offerPrice.value = ""
  offerError.value = ""
  offerTokenMint.value = DEFAULT_OFFER_TOKEN.mint
  offerPopupOpen.value = true
}

function buildPendingMarketMessage(
  tag: string,
  payload: MarketPayload,
  info?: ChatMarketInfo,
): PendingOutgoingMessage {
  if (!session.accountAddress) throw new Error("No connected account")
  return {
    id: `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    body: buildMarketPayload(payload),
    tag,
    displayBody: marketPayloadSummary(payload),
    market: info,
    status: "signing",
    senderAddress: session.accountAddress,
  }
}

async function submitOffer(): Promise<void> {
  const price = offerPrice.value.trim()
  if (!isValidPrice(price) || priceToRawUnits(price, offerToken.value.decimals) === undefined) {
    offerError.value = "Enter a valid price"
    return
  }
  const kind = offerKind.value
  const payload: MarketPayload = {
    kind,
    price,
    token: { ...offerToken.value },
    ...(kind === "counterOffer" && activeMarket.value
      ? { counterOf: activeMarket.value.message.messageId }
      : {}),
  }
  const info: ChatMarketInfo = {
    kind,
    price,
    token: { ...offerToken.value },
    superseded: false,
  }
  offerPopupOpen.value = false
  const pending = buildPendingMarketMessage(
    kind === "counterOffer" ? REALXHUB_COUNTER_OFFER_TAG : REALXHUB_OFFER_TAG,
    payload,
    info,
  )
  pendingMessages.value = [...pendingMessages.value, pending]
  await submitPending(pending)
}

// The seller accepts the counter-offer by re-sending it as a fresh offer;
// only the newest offer stays active, so this supersedes the old one.
async function acceptCounterOffer(): Promise<void> {
  const active = activeMarket.value
  if (!active || active.type !== "counterOffer" || !active.payload.token || !active.payload.price) return
  const token = active.payload.token
  const price = active.payload.price
  const payload: MarketPayload = { kind: "offer", price, token: { ...token } }
  const info: ChatMarketInfo = {
    kind: "offer",
    price,
    token: {
      cluster: token.cluster,
      mint: token.mint,
      symbol: token.symbol,
      decimals: token.decimals,
    },
    superseded: false,
  }
  const pending = buildPendingMarketMessage(REALXHUB_OFFER_TAG, payload, info)
  pendingMessages.value = [...pendingMessages.value, pending]
  await submitPending(pending)
}

async function refuseCounterOffer(): Promise<void> {
  const active = activeMarket.value
  const payload: MarketPayload = {
    kind: "refuse",
    ...(active ? { refusedOf: active.message.messageId } : {}),
  }
  const pending = buildPendingMarketMessage(REALXHUB_REFUSE_COUNTER_OFFER_TAG, payload)
  pendingMessages.value = [...pendingMessages.value, pending]
  await submitPending(pending)
}

// On-chain payment lands later — for now just flag the placeholder.
function makePayment(): void {
  paymentNotice.value = true
}

// Admin flips a member between seller/buyer via a status-tagged message.
async function setMemberStatus(address: string, status: MarketStatus): Promise<void> {
  if (!connectedAdmin.value || !session.accountAddress || updatingRole.value) return
  updatingRole.value = true
  try {
    await ensureRealXhubTag(REALXHUB_STATUS_TAG)
    const encrypted = await encryptOutgoing(buildStatusPayload({ address, status }))
    await bucketsRepository.createMessage(
      bucketId.value,
      encrypted,
      session.accountAddress,
      undefined,
      REALXHUB_STATUS_TAG,
    )
    operations.add("bucket_write", "Update marketplace role", "success", status)
    await loadAll()
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to update marketplace role"
  } finally {
    updatingRole.value = false
  }
}

// ── Create & share bucket encryption key (setup timeline step 2) ───
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
    typ: KEY_SHARING_MESSAGE_TAG
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
  if (!session.accountAddress) {
    failKey("Connect wallet before generating encryption keys")
    return
  }

  if (!canManageBucket.value) {
    failKey("Only bucket admins and namespace managers can generate and distribute encryption keys")
    return
  }

  // Null for standalone buckets — the API accepts a null namespace id there.
  const namespaceId = bucket.value?.namespaceId != null ? String(bucket.value.namespaceId) : null

  // Captured before the closure: the guard above narrows `session.accountAddress`
  // for this function body, but that narrowing does not survive into runKey's callback.
  const ownerAddress = session.accountAddress

  await runKey(async () => {
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
        throw new Error("Generated public key is missing JWK.x and cannot be used for key rotation")
      }

      const { recipientJwks, readerAddresses } = buildRecipientJwks(bucketPkJwk)
      const keySharingMessage = buildKeySharingMessage(bucketSkJwk, readerAddresses)
      const plaintextBytes = new TextEncoder().encode(keySharingMessage)
      const jweObject = await encryptJweForMultipleRecipients(plaintextBytes, recipientJwks)

      const batchResult = await bucketsRepository.rotateBucketKeyAndShare(
        namespaceId,
        bucketId.value,
        bucketEncryptionKey,
        KEY_SHARING_MESSAGE_TAG,
        JSON.stringify(jweObject),
        ownerAddress,
        applyKeyUpdate
      )

      operations.add(
        "bucket_write",
        "Encryption key",
        "success",
        `Bucket key rotated and shared: key ${keyId}, message ${batchResult.id}`
      )

      await loadAll()
    } catch (e) {
      // runKey records the message for the button; this inner catch keeps the
      // operation-log entry the page already had.
      const message = e instanceof Error ? e.message : "Unable to rotate bucket encryption key"
      operations.add("bucket_write", "Encryption key", "error", message)
      throw e instanceof Error ? e : new Error(message)
    }
  })
}

// ── Viewer key-access check (lazy, admins only) ────────────────────
// Compares each viewer's X25519 key against the recipient kids of the latest
// key-sharing JWE. Purely structural — needs no decryption capability.
async function checkViewerKeyAccess(): Promise<void> {
  const latest = latestKeySharingMessage(keySharingMessages.value)
  if (!latest) return // no key shared yet — the setup timeline covers that case

  if (payloadById.value[latest.id] === undefined) await hydratePayloads([latest])
  const payload = payloadById.value[latest.id]
  if (!payload) return

  const missing = findViewersWithoutKeyAccess(payload, viewerRecipients.value.map(r => r.x25519))
  if (missing !== null) viewersMissingKeyCount.value = missing.length
}

watch([loading, connectedAdmin], ([isLoading, isAdmin]) => {
  if (!isLoading && isAdmin && viewersMissingKeyCount.value === null) void checkViewerKeyAccess()
})

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

// ── Lifecycle ──────────────────────────────────────────────────────
// Pins the chat viewport to the newest message, then keeps it pinned briefly
// while layout settles: attachment images reserve no height, so each decode
// after the first scroll grows the content and a single scroll would leave the
// view stranded mid-history. Re-pinning stops once the height has been stable
// for ~15 frames (hard cap 2s), when the user scrolls up, or when a newer
// scrollToBottom call supersedes this one.
let scrollPass = 0
async function scrollToBottom() {
  const pass = ++scrollPass
  await nextTick()
  const viewport = chatViewportRef.value
  if (!viewport) return

  const pin = () => {
    viewport.scrollTop = viewport.scrollHeight
    return viewport.scrollTop
  }

  let lastHeight = viewport.scrollHeight
  let lastTop = pin()
  let stableFrames = 0
  const deadline = performance.now() + 2000

  while (stableFrames < 15 && performance.now() < deadline) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    if (pass !== scrollPass) return
    // scrollTop only ever decreases when the user scrolls up — content growth
    // and scroll anchoring can only push it down. Hands off from then on.
    if (viewport.scrollTop < lastTop - 1) return
    if (viewport.scrollHeight === lastHeight) {
      lastTop = viewport.scrollTop
      stableFrames += 1
      continue
    }
    lastHeight = viewport.scrollHeight
    lastTop = pin()
    stableFrames = 0
  }
}

// Reading position wins over live messages: only pin to a new message when
// the user was already at (or near) the bottom. Sampled in the watch callback,
// which runs pre-flush — before the DOM grows with the new entry.
function isNearBottom(): boolean {
  const viewport = chatViewportRef.value
  if (!viewport) return true
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 150
}

watch(() => chatMessages.value.length, () => {
  if (isNearBottom()) void scrollToBottom()
})
// The user's own sends always pin, even from deep in the history — their
// message (as a pending bubble) appears at the bottom.
watch(() => pendingMessages.value.length, (count, previous) => {
  if (count > (previous ?? 0)) void scrollToBottom()
})
// The loader replaces the message list wholesale, so when it clears the list
// mounts fresh with scrollTop 0 and no length change to re-trigger the watch
// above — scroll explicitly.
watch(showChatLoading, isLoading => {
  if (!isLoading) void scrollToBottom()
})
// A key rotation is relevant again whenever the viewer set changes (e.g. a
// member with the viewer role is added or removed) — re-arm the button instead
// of leaving it stuck on "Key shared" until the page unmounts.
watch(() => viewerRecipients.value.length, resetKey)
watch(() => settings.x25519SecretJwk, async () => {
  // A different secret changes what everything decrypts to — treat it like a
  // reload: hold live applies (and wait out any in flight) while the whole
  // history re-decrypts, or a concurrent apply's map write-backs would race
  // this one's and the loser's plaintext would vanish.
  rekeying.value = true
  try {
    await incomingPump.idle()
    keySharingMessages.value = await bucketsRepository.fetchMessagesByTag(bucketId.value, KEY_SHARING_MESSAGE_TAG)
    await hydratePayloads(keySharingMessages.value)
    await decryptKeySharingFromMessages(keySharingMessages.value)
    await decryptMessages(messages.value)
    if (isRealXhubBucket.value) {
      await decryptMessages([...realxhubMarketMessages.value, ...realxhubStatusMessages.value])
    }
    await hydrateAttachments(messages.value)
  } finally {
    rekeying.value = false
    incomingPump.flush()
  }
}, { deep: true })

onMounted(async () => {
  settings.initialize()
  // The initial load and the subscription race each other, in both orders:
  // events landing mid-load are buffered by the pump and deduplicated after,
  // and the subscribe ack triggers a catch-up fetch that reconciles anything
  // written before the subscription became active.
  connectMessagesSocket()
  // No explicit scroll here: loadAll's completion flips showChatLoading off,
  // and that watch scrolls once the message list has actually mounted.
  await loadAll()
})
</script>

<template>
  <div class="chat-page-container ib-custom-page">
    <!-- Header -->
    <PageHeader :title="bucketDisplayName" contained>
      <template #actions>
        <button class="btn" :disabled="loading" @click="loadAll">Reload</button>
        <NuxtLink class="btn" :to="`/messages/bucket/${encodeURIComponent(bucketId)}/info`">Info</NuxtLink>
      </template>
    </PageHeader>

    <!-- realXhub marketplace: active offer / counter-offer bar -->
    <div v-if="!loading && isRealXhubBucket && activeMarket && myStatus && connectedAdminOrContributor"
      class="ib-container ib-offer-bar" role="region" aria-label="Marketplace offer">
      <div class="ib-offer-inner">
        <HandCoins :size="18" class="ib-offer-icon" />
        <div class="ib-offer-info">
          <p class="ib-offer-title">
            {{ marketKindLabel(activeMarket.type) }}
            <template v-if="activeMarketIsMine"> you made</template>
            <template v-else> from {{ formatAddress(activeMarket.message.contributor) }}</template>
          </p>
          <p v-if="activeMarket.payload.price !== undefined" class="ib-offer-amount">
            Total: <strong>{{ formatPriceAmount(activeMarket.payload.price) }}</strong>
            <template v-if="activeMarket.payload.token">
              {{ activeMarket.payload.token.symbol }}
              <span class="ib-offer-token-meta">
                ({{ tokenClusterLabel(activeMarket.payload.token.cluster) }} ·
                {{ shortMint(activeMarket.payload.token.mint) }})
              </span>
            </template>
          </p>
        </div>
        <div v-if="myStatus === 'buyer' && activeMarket.type === 'offer'" class="ib-offer-actions">
          <button class="btn" :disabled="sending" @click="openOfferPopup('counterOffer')">Make counter-offer</button>
          <button class="btn btn-primary" :disabled="sending" @click="makePayment">Make payment</button>
          <span v-if="paymentNotice" class="ib-offer-note">Payment flow coming soon.</span>
        </div>
        <div v-else-if="myStatus === 'seller' && activeMarket.type === 'counterOffer'" class="ib-offer-actions">
          <button class="btn" :disabled="sending" @click="refuseCounterOffer">Refuse counter-offer</button>
          <button class="btn btn-primary" :disabled="sending" @click="acceptCounterOffer">Accept counter-offer</button>
        </div>
        <p v-else class="ib-offer-waiting">Waiting for the other party…</p>
      </div>
    </div>

    <div class="ib-container">
      <p v-if="error" class="ib-error">{{ error }}</p>

      <!-- Admin-only: some viewers are missing from the latest key-sharing message -->
      <div v-if="!loading && connectedAdmin && viewersMissingKeyCount" class="ib-key-status ib-key-warning"
        role="alert">
        <ShieldAlert :size="18" class="ib-key-warning-icon" />
        <span class="ib-key-warning-text">
          {{ viewersMissingKeyCount }} {{ viewersMissingKeyCount === 1 ? "viewer does" : "viewers do" }}
          not have access to the encryption key.
        </span>
        <SubmitButton
          class="ib-key-warning-btn"
          :phase="keyPhase"
          :labels="keyWarningLabels"
          @click="createAndShareEncryptionKey"
        >
          <template #icon><KeyRound :size="14" /></template>
        </SubmitButton>
      </div>
      <p v-if="createKeyError && viewersMissingKeyCount" class="ib-error">{{ createKeyError }}</p>

      <!-- realXhub: admin manages marketplace roles (seller / buyer) -->
      <details v-if="!loading && isRealXhubBucket && connectedAdmin" class="card ib-panel">
        <summary class="ib-panel-summary">
          Marketplace roles
          <span class="ib-panel-toggle">+</span>
        </summary>
        <div class="ib-panel-body">
          <p v-if="!realxhubRoleMembers.length" class="muted">No members found.</p>
          <div v-for="member in realxhubRoleMembers" :key="member.address" class="ib-role-row">
            <span class="ib-role-address" :title="member.address">
              {{ formatAddress(member.address) }}
              <span class="muted ib-role-tag">{{ member.role }}</span>
            </span>
            <div class="ib-status-toggle">
              <button class="ib-status-btn" :class="{ 'ib-status-btn-active': member.status === 'seller' }"
                :disabled="updatingRole || sending" @click="setMemberStatus(member.address, 'seller')">
                Seller
              </button>
              <button class="ib-status-btn" :class="{ 'ib-status-btn-active': member.status === 'buyer' }"
                :disabled="updatingRole || sending" @click="setMemberStatus(member.address, 'buyer')">
                Buyer
              </button>
            </div>
          </div>
        </div>
      </details>
    </div>

    <!-- Chat viewport -->
    <div ref="chatViewportRef" class="ib-chat-viewport chat-viewport" role="log" aria-live="polite"
      aria-label="Indexed bucket messages">
      <ParticleLoader v-if="showChatLoading" size="page" label="Loading messages..." class="ib-chat-loading" />
      <div v-else class="ib-container ib-chat-inner">
        <ChatMessageEntry v-for="msg in chatMessages" :key="msg.id" :message="msg" :show-avatars="true"
          @retry="retryFailedMessage(msg.id)" @discard="discardFailedMessage(msg.id)" />

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
                  Generate a fresh Encryption key secret and share it with everyone in the bucket using their X25519 keys.
                </p>
                <p v-if="!keyStepActive" class="muted ib-tl-hint">
                  Add at least 2 members to unlock this step.
                </p>
                <p v-else-if="!viewerRecipients.length" class="muted ib-tl-hint">
                  No viewer X25519 keys are available yet. Members must be added with the viewer role before
                  the key can be shared.
                </p>
                <SubmitButton
                  class="ib-tl-btn"
                  :phase="keyPhase"
                  :labels="keyTimelineLabels"
                  :disabled="!keyStepActive || loading || !session.accountAddress || !viewerRecipients.length"
                  @click="createAndShareEncryptionKey"
                >
                  <template #icon><KeyRound :size="16" /></template>
                </SubmitButton>
                <p v-if="createKeyError" class="ib-tl-error">{{ createKeyError }}</p>
              </div>
            </li>
          </ol>
        </div>

        <p v-else-if="!chatMessages.length && !loading" class="muted" style="text-align:center">
          No messages found for this bucket.
        </p>
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
        <div class="ib-footer-notice">
          <ShieldAlert :size="20" class="ib-footer-notice-icon" />
          <div class="ib-footer-notice-text">
            <strong>Not a contributor</strong>
            <span class="muted">Your connected wallet is not a contributor to this bucket. Ask an admin to add you.</span>
          </div>
        </div>
      </div>
    </div>

    <!-- (C) Authorized but the current bucket key is unreadable → no composer:
         anything sent would be encrypted to a key this user cannot read back. -->
    <div v-else-if="!loading && !showSetupTimeline && keyAccessState !== 'ok'" class="ib-footer-sticky">
      <div class="ib-container">
        <div class="ib-footer-notice" :class="{ 'ib-footer-notice-info': keyAccessState !== 'no-access' }">
          <ShieldAlert v-if="keyAccessState === 'no-access'" :size="20" class="ib-footer-notice-icon" />
          <KeyRound v-else :size="20" class="ib-footer-notice-icon" />
          <div class="ib-footer-notice-text">
            <strong>{{ keyAccessNotice.title }}</strong>
            <span class="muted">{{ keyAccessNotice.detail }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- (D) Authorized → Message composer (hidden while the setup timeline is guiding the user) -->
    <div v-else-if="!showSetupTimeline" class="ib-footer-sticky">
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
            <button v-if="!sendText && isRealXhubBucket && myStatus === 'seller' && !activeMarket" type="button"
              class="ib-composer-offer" :disabled="sending || !activeSecretJwk" title="Make offer"
              @click="openOfferPopup('offer')">
              <HandCoins :size="18" />
            </button>
            <textarea ref="composerInputRef" v-model="sendText" class="input ib-composer-input composer-scroll"
              name="message-text" placeholder="Write a message" rows="1" :disabled="sending" />
          </template>
          <button class="btn btn-primary ib-composer-send" type="submit"
            :disabled="sending || loading || !activeSecretJwk">
            <SendHorizontal :size="18" />
          </button>
        </form>
        <div class="ib-footer-meta">
          <p v-if="sendError" style="margin:0; color:var(--status-error); text-align:center; font-size:13px">
            {{ sendError }}
          </p>
        </div>
      </div>
    </div>

    <!-- realXhub offer / counter-offer popup -->
    <div v-if="offerPopupOpen" class="ib-wallet-overlay" @click.self="offerPopupOpen = false">
      <div class="card stack ib-offer-popup">
        <div class="row" style="justify-content: space-between; align-items: center">
          <h3 style="margin: 0">{{ offerKind === "counterOffer" ? "Make a counter-offer" : "Make an offer" }}</h3>
          <button class="btn" type="button" aria-label="Close" @click="offerPopupOpen = false">
            <X :size="14" />
          </button>
        </div>
        <p class="muted" style="margin: 0">
          {{ offerKind === "counterOffer"
            ? "Propose a different price for the active offer."
            : "Set the price you want to accept to list this bucket for sale." }}
        </p>
        <form class="stack" @submit.prevent="submitOffer">
          <label class="ib-field" for="ib-offer-price">
            <span class="ib-field-label">Price</span>
            <input id="ib-offer-price" v-model="offerPrice" class="input" type="number" step="any" min="0"
              inputmode="decimal" placeholder="0.00" required :disabled="sending" />
          </label>
          <label class="ib-field" for="ib-offer-token">
            <span class="ib-field-label">Token</span>
            <select id="ib-offer-token" v-model="offerTokenMint" class="input" :disabled="sending">
              <option v-for="token in SOLANA_TOKENS" :key="token.mint" :value="token.mint">
                {{ token.symbol }} — {{ tokenClusterLabel(token.cluster) }}
              </option>
            </select>
          </label>
          <p v-if="offerError" class="ib-tl-error">{{ offerError }}</p>
          <div class="row ib-offer-popup-actions">
            <button class="btn" type="button" @click="offerPopupOpen = false" :disabled="sending">Cancel</button>
            <button class="btn btn-primary" type="submit" :disabled="sending">
              {{ offerKind === "counterOffer" ? "Counter-offer" : "Place offer" }}
            </button>
          </div>
        </form>
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

        <ParticleLoader v-if="loadingWalletAccounts" label="Loading wallets..." />

        <div v-else-if="walletAccounts.length" class="stack" style="max-height: 300px; overflow: auto; gap: 8px">
          <button v-for="account in walletAccounts" :key="account.address" class="btn" type="button"
            :disabled="selectingWallet"
            style="display: flex; justify-content: space-between; align-items: center; text-align: left"
            @click="selectWalletAccount(account.address)">
            <ParticleLoader v-if="selectingWallet" size="inline" label="Connecting wallet" style="min-width: 0" />
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

/* Kill PageHeader's vertical padding so no gap sits above the first message. */
.chat-page-container .page-header__inner {
  padding-top: 0;
  padding-bottom: 0;
}

.ib-container {
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
  padding: 0 48px;
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
  margin: 8px 0 0px;
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

.ib-key-warning {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 14px;
}

.ib-key-warning-icon {
  flex-shrink: 0;
}

.ib-key-warning-text {
  flex: 1;
  min-width: 0;
}

.ib-key-warning-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

/* Chat Viewport: Matches reference chat-viewport */
.ib-chat-viewport {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  /* Never horizontally scrollable: overflow-y alone would compute overflow-x
     to auto, turning any over-wide message into a horizontal scrollbar. */
  overflow-x: hidden;
  background: transparent;
  overscroll-behavior: contain;
  min-height: 0;
  -webkit-overflow-scrolling: touch;
  padding-top: 10px;
}

/* Fills the whole viewport while payloads hydrate and decrypt. */
.ib-chat-loading {
  flex: 1;
}

.ib-chat-inner {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 16px;
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

/* ── Footer notices in place of the composer (variants B and C) ─── */
/* Warning tone by default — something is denied. The -info modifier is for the
   states that are merely not set up yet, which are nobody's fault. */
.ib-footer-notice {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--status-warning) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--status-warning) 25%, transparent);
}

.ib-footer-notice-icon {
  flex-shrink: 0;
  color: var(--status-warning);
}

.ib-footer-notice-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  min-width: 0;
}

.ib-footer-notice-text strong {
  font-size: 14px;
  color: var(--text-primary);
}

.ib-footer-notice-info {
  background: color-mix(in srgb, var(--color-primary) 6%, transparent);
  border-color: color-mix(in srgb, var(--color-primary) 20%, transparent);
}

.ib-footer-notice-info .ib-footer-notice-icon {
  color: var(--color-primary);
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
  /* Three lines, border-box: 3 × 22px line + 16px padding + 4px border. Keep in
     sync with the line-height and padding below — useAutoGrowTextarea only ever
     asks to fit the content, and this is what stops it. */
  max-height: 86px;
  /* Exactly half the 42px single-line height, so the composer is an identical
     pill at rest and relaxes into a rounded rectangle as it grows. A 999px
     radius would resolve to a 43px curve at three lines — a stadium, with the
     text hugging the bends. */
  border-radius: 21px;
  padding: 8px 14px;
  background: var(--surface-bg);
  border: 1px solid var(--border-default);
  border-width: 2px;
  resize: none;
  line-height: 22px;
  font-size: 14px;
  transition: border-color 150ms;
}

.ib-composer-input:focus {
  border-color: var(--color-primary);
  border-width: 2px;
  outline: none;
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

/* realXhub marketplace: offer / counter-offer bar */
.ib-offer-bar {
  margin-top: 8px;
}

.ib-offer-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--border-default);
  border-left: 3px solid var(--color-primary);
  border-radius: 12px;
  background: var(--surface-bg);
}

.ib-offer-icon {
  flex-shrink: 0;
  color: var(--color-primary);
}

.ib-offer-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ib-offer-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ib-offer-amount {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.ib-offer-amount strong {
  color: var(--text-primary);
}

.ib-offer-token-meta {
  font-size: 12px;
  color: var(--text-secondary);
}

.ib-offer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: auto;
}

.ib-offer-note {
  font-size: 12px;
  color: var(--text-secondary);
}

.ib-offer-waiting {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

/* realXhub marketplace: composer offer button */
.ib-composer-offer {
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
  color: var(--color-primary);
  transition: border-color 150ms, color 150ms;
}

.ib-composer-offer:hover:not(:disabled) {
  border-color: var(--color-primary);
}

/* realXhub marketplace: offer popup */
.ib-offer-popup {
  width: min(440px, 92vw);
}

.ib-offer-popup-actions {
  justify-content: flex-end;
  margin-top: 4px;
}

.ib-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ib-field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

/* realXhub marketplace: roles panel */
.ib-role-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-default);
}

.ib-role-row:last-child {
  border-bottom: none;
}

.ib-role-address {
  font-size: 14px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ib-role-tag {
  font-size: 11px;
  margin-left: 6px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.ib-status-toggle {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.ib-status-btn {
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 150ms, background 150ms, color 150ms;
}

.ib-status-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.ib-status-btn-active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.ib-status-btn-active:hover:not(:disabled) {
  color: #fff;
}

@media (max-width: 840px) {

  .ib-container {
    padding: 0 16px;
  }

  .ib-connect-prompt,
  .ib-footer-notice {
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

  .ib-offer-inner {
    flex-direction: column;
    align-items: stretch;
  }

  .ib-offer-actions {
    margin-left: 0;
    width: 100%;
    flex-wrap: wrap;
  }
}
</style>
