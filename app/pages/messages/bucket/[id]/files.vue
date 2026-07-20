<script setup lang="ts">
import { fetchFileMessages, type IndexedMessage } from "../../../../services/indexer/subqueryClient"
import { DidCommRepository, type BucketRecord } from "../../../../services/papi/didCommRepository"
import ChatMessageEntry, { type ChatMessageProps, type ChatMessageAttachment } from "../../../../components/common/ChatMessageEntry.vue"
import LoadingBar from "../../../../components/common/LoadingBar.vue"
import { Paperclip, ArrowLeft } from "lucide-vue-next"
import { hexToU8a } from "@polkadot/util"
import * as jose from "jose"
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { useNuxtApp, useRoute, useRuntimeConfig } from "nuxt/app"
import { useSessionStore } from "../../../../stores/session"
import { useSettingsStore } from "../../../../stores/settings"
import { useAddress } from "../../../../composables/useAddress"

const route = useRoute()
const { $papiClient } = useNuxtApp()
const config = useRuntimeConfig()
const session = useSessionStore()
const settings = useSettingsStore()
const { formatAddress, addressesEqual } = useAddress()

const asOptionalString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

const didCommRepository = new DidCommRepository(
  $papiClient as { rpc(method: string, params?: unknown[]): Promise<unknown>; getEndpoint?(): string },
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  { // 16 pinataConfig
    jwt: asOptionalString(config.public.pinataJwt),
    apiKey: asOptionalString(config.public.pinataApiKey),
    apiSecret: asOptionalString(config.public.pinataApiSecret),
    publicGateway: asOptionalString(config.public.pinataGateway)
  },
  undefined, undefined, undefined,
  String(config.public.subqueryIndexerUrl || "") // 20 indexerUrl
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

const textMessageContentType = "text/plain;charset=utf-8"
const keySharingContentType = "application/didcomm-encrypted+json"
const keySharingTag = "didcomm/key-sharing-v1"

// ── State ──────────────────────────────────────────────────────────
const loading = ref(true)
const error = ref("")
const messages = ref<IndexedMessage[]>([])
const payloadById = ref<Record<string, string>>({})
const payloadErrorById = ref<Record<string, string>>({})
const decryptedById = ref<Record<string, string>>({})
const decryptErrorById = ref<Record<string, string>>({})
const attachmentById = ref<Record<string, ChatMessageAttachment>>({})
const activeSecretJwk = ref<jose.JWK | null>(null)

// ── File attachments (CID-pointer messages) ────────────────────────
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

async function decryptKeySharing() {
  const keySharingMessages = messages.value.filter(m => m.tag === keySharingTag)
  if (!keySharingMessages.length) {
    return
  }

  const secretJwk = settings.x25519SecretJwk
  if (!secretJwk) {
    return
  }

  // Try from latest to earliest to find the most recent working key
  const reversed = [...keySharingMessages].reverse()
  for (const ksMsg of reversed) {
    const raw = payloadById.value[ksMsg.id]
    if (!raw?.trim()) continue

    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue
      const key = await jose.importJWK(secretJwk as jose.JWK, "ECDH-ES+A256KW")
      const { plaintext } = await jose.generalDecrypt(parsed as jose.GeneralJWE, key)
      const decoded = new TextDecoder().decode(plaintext)
      const inner = JSON.parse(decoded)
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        const keys = Array.isArray(inner.keys) ? inner.keys : []
        for (const k of keys) {
          if (k && typeof k === "object" && k.kty === "OKP" && k.crv === "X25519" && typeof k.x === "string" && typeof k.d === "string") {
            activeSecretJwk.value = { ...k, use: "enc" }
            break
          }
        }
      }
      if (activeSecretJwk.value) return // found a working key
    } catch {
      // This key-sharing message didn't decrypt, try the next one
    }
  }
}

async function decryptFileMessages(msgs: IndexedMessage[]) {
  const nextD: Record<string, string> = {}
  const nextE: Record<string, string> = {}
  const sk = activeSecretJwk.value
  if (!sk || !isX25519Secret(sk)) {
    decryptedById.value = {}
    decryptErrorById.value = {}
    return
  }

  await Promise.all(msgs.map(async m => {
    if (m.tag === keySharingTag) return
    const p = payloadById.value[m.id]
    if (!p) return
    const t = p.trim()
    if (!looksLikeCompactJwe(t)) {
      nextD[m.id] = p
      return
    }
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

function isX25519Secret(v: unknown): v is jose.JWK {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false
  const c = v as Record<string, unknown>
  return c.kty === "OKP" && c.crv === "X25519" && typeof c.x === "string" && typeof c.d === "string"
}

function looksLikeCompactJwe(s: string): boolean {
  const p = s.split(".")
  return p.length === 5 && p.every(x => x.length > 0)
}

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
    if (m.ipfsContent) {
      nextP[m.id] = m.ipfsContent
      return
    }
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

// ── Load everything via GraphQL ────────────────────────────────────
async function loadAll() {
  error.value = ""
  loading.value = true
  try {
    const url = indexerUrl.value
    if (!url) throw new Error("SubQuery indexer URL is not configured")

    // 1. Fetch file messages (only files, not text messages)
    const fileMessages = await fetchFileMessages(url, bucketId.value)

    // 2. Filter to only file messages (non-text, non-key-sharing)
    const fileMsgs = fileMessages.filter(isFileMessage)

    // 3. Also get key-sharing messages to decrypt the bucket key
    const keySharingMessages = fileMessages.filter(m => m.tag === keySharingTag)

    // 4. Hydrate their payloads so we can decrypt them
    await hydratePayloads(keySharingMessages)

    // 5. Decrypt key-sharing messages to find active key
    await decryptKeySharing()

    // 6. Hydrate all file message payloads
    await hydratePayloads(fileMsgs)

    // 7. Decrypt file messages
    await decryptFileMessages(fileMsgs)

    // 8. Hydrate file attachments
    await hydrateAttachments(fileMsgs)

    messages.value = fileMsgs
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load file messages"
  } finally {
    loading.value = false
  }
}

// ── Chat message rendering ─────────────────────────────────────────
const chatMessages = computed<ChatMessageProps[]>(() => {
  // Sort messages chronologically so oldest is at the top, newest at the bottom
  const sortedMessages = [...messages.value].sort((a, b) => a.createdBlock - b.createdBlock)

  return sortedMessages.map(m => {
    const payload = decryptedById.value[m.id] ?? payloadById.value[m.id]
    const payloadBody = payload ? payload : undefined
    const body = payloadBody ?? m.description ?? m.ipfsContent ?? `Message #${m.messageId}`
    const outgoing = Boolean(session.accountAddress && addressesEqual(m.contributor, session.accountAddress))

    // Get sender nickname if available, fallback to address
    const senderAddress = m.contributor ?? ""
    const senderLabel = outgoing ? "You" : formatAddress(senderAddress)

    return {
      id: m.id, body, outgoing,
      senderLabel,
      senderAddress, tag: m.tag ?? undefined,
      reference: m.reference ?? undefined,
      payloadError: payloadErrorById.value[m.id] ?? decryptErrorById.value[m.id],
      contentType: m.contentType ?? undefined,
      attachment: attachmentById.value[m.id],
      timestampLabel: `Block #${m.createdBlock}`,
      debugEntries: [],
    }
  })
})

// ── Utility ────────────────────────────────────────────────────────
function formatAddressShort(address: string): string {
  if (!address) return ""
  return `${address.slice(0, 8)}...${address.slice(-8)}`
}

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
  await loadAll()
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
            <h3 class="ib-title">Bucket Files</h3>
            <span class="muted ib-subtitle">Files and images from bucket {{ bucketId }}</span>
          </div>
        </div>
        <div class="row ib-header-actions">
          <NuxtLink class="btn" :to="`/messages/bucket/${encodeURIComponent(bucketId)}/info`">
            <ArrowLeft :size="16" />
            Back to Info
          </NuxtLink>
        </div>
      </div>
    </header>

    <div class="ib-container">
      <LoadingBar v-if="loading" label="Querying SubQuery indexer..." style="flex-shrink:0;" />
      <p v-if="error" class="ib-error">{{ error }}</p>
    </div>

    <!-- Files viewport -->
    <div class="ib-chat-viewport chat-viewport" role="log" aria-live="polite" aria-label="Bucket file messages">
      <div class="ib-container ib-chat-inner">
        <!-- File messages -->
        <ChatMessageEntry v-for="msg in chatMessages" :key="msg.id" :message="msg" :show-avatars="false" />

        <!-- Empty state -->
        <p v-if="!loading && !chatMessages.length" class="muted" style="text-align:center; padding: 40px 0;">
          <Paperclip :size="48" class="muted" style="opacity: 0.3; margin-bottom: 16px;" />
          <br>
          No files found for this bucket in the indexer.
        </p>

        <div id="chat-bottom-anchor"></div>
      </div>
    </div>
  </div>
</template>

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

.ib-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
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

/* Scrollable area */
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

/* File message styles */
.chat-message {
  max-width: min(78%, 560px);
}

.chat-row-outgoing .chat-message {
  align-items: flex-end;
}

.chat-attachment-file {
  max-width: 100%;
}

@media (max-width: 960px) {
  .ib-container {
    padding: 0 16px;
  }
}

@media (max-width: 840px) {
  .ib-chat-inner {
    padding-top: 16px;
    padding-bottom: 16px;
  }

  .chat-message {
    max-width: 100%;
  }
}
</style>
