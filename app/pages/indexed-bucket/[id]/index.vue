<script setup lang="ts">
import { fetchIndexedBucketDetail, fetchIndexedMessagesByTag, type IndexedBucket, type IndexedMessage, type IndexedBucketMember } from "../../../services/indexer/subqueryClient"
import { DidCommRepository, type ExtrinsicUpdate } from "../../../services/papi/didCommRepository"
import LoadingBar from "../../../components/common/LoadingBar.vue"
import ChatMessageEntry, { type ChatMessageProps } from "../../../components/common/ChatMessageEntry.vue"
import { Paperclip, X, SendHorizontal, Wallet, ShieldAlert } from "lucide-vue-next"
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
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  {
    jwt: asOptionalString(config.public.pinataJwt),
    apiKey: asOptionalString(config.public.pinataApiKey),
    apiSecret: asOptionalString(config.public.pinataApiSecret),
    publicGateway: asOptionalString(config.public.pinataGateway)
  },
  undefined,
  undefined,
  undefined,
  String(config.public.subqueryIndexerUrl || "")
)

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
const messages = ref<IndexedMessage[]>([])

const payloadById = ref<Record<string, string>>({})
const payloadErrorById = ref<Record<string, string>>({})
const decryptedById = ref<Record<string, string>>({})
const decryptErrorById = ref<Record<string, string>>({})
const activeSecretJwk = ref<jose.JWK | null>(null)
const keySharingError = ref("")

const sendText = ref("")
const sendError = ref("")
const sending = ref(false)
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

// ── Chat message rendering ─────────────────────────────────────────
const chatMessages = computed<ChatMessageProps[]>(() => {
  // Sort messages chronologically so oldest is at the top, newest at the bottom
  const sortedMessages = [...messages.value].sort((a, b) => a.createdBlock - b.createdBlock)

  return sortedMessages.map(m => {
    const payload = decryptedById.value[m.id] ?? payloadById.value[m.id]
    const payloadBody = payload ? summarize(payload) ?? payload : undefined
    const body = payloadBody ?? m.description ?? m.ipfsContent ?? `Message #${m.messageId}`
    const outgoing = Boolean(session.accountAddress && addressesEqual(m.contributor, session.accountAddress))

    const debugEntries: { key: string; value: string }[] = []
    debugEntries.push({ key: "ID", value: m.id })
    if (m.contributor) debugEntries.push({ key: "Sender", value: m.contributor })
    if (m.tag) debugEntries.push({ key: "Tag", value: m.tag })
    if (m.contentType) debugEntries.push({ key: "Content Type", value: m.contentType })
    if (m.reference) debugEntries.push({ key: "IPFS Ref", value: m.reference })
    debugEntries.push({ key: "Block", value: formatBlock(m.createdBlock) })

    return {
      id: m.id, body, outgoing,
      senderLabel: outgoing ? "You" : formatAddress(m.contributor),
      senderAddress: m.contributor, tag: m.tag ?? undefined,
      reference: m.reference ?? undefined,
      payloadError: payloadErrorById.value[m.id] ?? decryptErrorById.value[m.id],
      contentType: m.contentType ?? undefined,
      timestampLabel: formatBlock(m.createdBlock),
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
    messages.value = detail.messages

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

// ── Send message (encrypted with latest key) ───────────────────────
async function encryptOutgoing(plaintext: string): Promise<string> {
  const sk = activeSecretJwk.value
  if (!sk || !isX25519Secret(sk)) {
    throw new Error("No decrypted bucket key available. Decrypt key-sharing first.")
  }

  const recipientPublicJwk: jose.JWK = {
    kty: "OKP", crv: "X25519", x: sk.x as string, use: "enc",
    kid: typeof sk.kid === "string" ? sk.kid : undefined
  }
  const publicKey = await jose.importJWK(recipientPublicJwk, "ECDH-ES+A256KW")
  return await new jose.CompactEncrypt(new TextEncoder().encode(plaintext))
    .setProtectedHeader({ alg: "ECDH-ES+A256KW", enc: "A256GCM", typ: "didcomm/encrypted-message-v1", kid: recipientPublicJwk.kid })
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

function buildAttachmentEnvelope(file: File, base64Data: string): string {
  const base64 = base64Data.includes(",") ? base64Data.split(",")[1]! : base64Data
  return JSON.stringify({
    type: "attachment",
    contentType: file.type || "application/octet-stream",
    fileName: file.name,
    data: base64,
  })
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
    const plaintext = attachment
      ? buildAttachmentEnvelope(attachment.file, attachment.dataUrl)
      : textPayload
    const encrypted = await encryptOutgoing(plaintext)
    const result = await didCommRepository.createMessage(
      bucketId.value, encrypted, session.accountAddress, logExtrinsicUpdate
    )
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
}, { deep: true })

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
        <ChatMessageEntry v-for="msg in chatMessages" :key="msg.id" :message="msg" />
        <p v-if="!chatMessages.length && !loading" class="muted" style="text-align:center">
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

        <p v-else class="muted" style="margin: 0">No wallets found.</p>
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
  background: color-mix(in srgb, var(--status-success) 8%, transparent);
  color: var(--status-success);
  border-color: color-mix(in srgb, var(--status-success) 25%, transparent);
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
}
</style>