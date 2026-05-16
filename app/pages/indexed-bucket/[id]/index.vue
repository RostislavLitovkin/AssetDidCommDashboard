<script setup lang="ts">
import { fetchIndexedBucketDetail, fetchIndexedMessagesByTag, type IndexedBucket, type IndexedMessage, type IndexedBucketMember } from "../../../services/indexer/subqueryClient"
import { DidCommRepository, type ExtrinsicUpdate } from "../../../services/papi/didCommRepository"
import LoadingBar from "../../../components/common/LoadingBar.vue"
import ChatMessageEntry, { type ChatMessageProps } from "../../../components/common/ChatMessageEntry.vue"
import { Paperclip, X, SendHorizontal } from "lucide-vue-next"
import { useAddress } from "../../../composables/useAddress"
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
  }
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
const loading = ref(false)
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

// ── Chat message rendering ─────────────────────────────────────────
const chatMessages = computed<ChatMessageProps[]>(() =>
  messages.value.map(m => {
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
)

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
  <div class="ib-page">
    <!-- Header -->
    <header class="ib-header">
      <div class="ib-header-left">
        <div class="ib-source-badge">⚡ Indexed</div>
        <h3 class="ib-title">{{ bucketDisplayName }}</h3>
        <span v-if="bucket" class="ib-subtitle">
          Namespace {{ bucket.namespaceId }} · Bucket #{{ bucket.bucketId }}
          <template v-if="bucket.creator"> · by {{ formatAddress(bucket.creator) }}</template>
        </span>
      </div>
      <div class="ib-header-actions">
        <button class="btn" :disabled="loading" @click="loadAll">Reload</button>
      </div>
    </header>

    <LoadingBar v-if="loading" label="Querying SubQuery indexer..." style="flex-shrink:0; margin: 0 18px;" />
    <p v-if="error" class="ib-error">{{ error }}</p>

    <!-- Info panel -->
    <details v-if="bucket" class="ib-panel">
      <summary class="ib-panel-summary">
        <span>Bucket Info</span>
        <span class="ib-panel-toggle">+</span>
      </summary>
      <div class="ib-panel-body">
        <dl class="ib-meta">
          <div class="ib-meta-row"><dt>ID</dt><dd>{{ bucket.id }}</dd></div>
          <div class="ib-meta-row"><dt>Namespace ID</dt><dd>{{ bucket.namespaceId }}</dd></div>
          <div class="ib-meta-row"><dt>Name</dt><dd>{{ bucket.name || "—" }}</dd></div>
          <div class="ib-meta-row"><dt>Category</dt><dd>{{ bucket.category || "—" }}</dd></div>
          <div class="ib-meta-row"><dt>Creator</dt><dd>{{ bucket.creator ? formatAddress(bucket.creator) : "—" }}</dd></div>
          <div class="ib-meta-row"><dt>Writable</dt><dd>{{ bucket.isWritable ? "Yes" : "No" }}</dd></div>
          <div class="ib-meta-row"><dt>Created</dt><dd>{{ formatBlock(bucket.createdBlock) }}</dd></div>
          <div v-if="bucket.encryptionKey" class="ib-meta-row"><dt>Encryption Key</dt><dd class="mono">{{ bucket.encryptionKey }}</dd></div>
        </dl>
      </div>
    </details>

    <!-- Members panel -->
    <details v-if="admins.length || contributors.length" class="ib-panel">
      <summary class="ib-panel-summary">
        <span>Members ({{ admins.length }} admins · {{ contributors.length }} contributors)</span>
        <span class="ib-panel-toggle">+</span>
      </summary>
      <div class="ib-panel-body">
        <h4 class="ib-section-label" v-if="admins.length">Admins</h4>
        <ul class="ib-member-list">
          <li v-for="a in admins" :key="a.id" class="ib-member-item">
            <span class="ib-member-address">{{ formatAddress(a.subjectId) }}</span>
            <span class="ib-member-block">{{ formatBlock(a.addedBlock) }}</span>
          </li>
        </ul>
        <h4 class="ib-section-label" v-if="contributors.length" style="margin-top:12px">Contributors</h4>
        <ul class="ib-member-list">
          <li v-for="c in contributors" :key="c.id" class="ib-member-item">
            <span class="ib-member-address">{{ formatAddress(c.subjectId) }}</span>
            <span class="ib-member-block">{{ formatBlock(c.addedBlock) }}</span>
          </li>
        </ul>
      </div>
    </details>

    <!-- Key sharing status -->
    <div v-if="keySharingError && !loading" class="ib-key-status">
      🔒 {{ keySharingError }}
    </div>
    <div v-else-if="activeSecretJwk && !loading" class="ib-key-status ib-key-ok">
      🔓 Bucket encryption key decrypted successfully
    </div>

    <!-- Chat viewport -->
    <div class="ib-chat-viewport" role="log" aria-live="polite" aria-label="Indexed bucket messages">
      <ChatMessageEntry v-for="msg in chatMessages" :key="msg.id" :message="msg" />
      <p v-if="!chatMessages.length && !loading" class="muted" style="text-align:center">
        No messages found for this bucket in the indexer.
      </p>
    </div>

    <!-- Message composer -->
    <div class="ib-footer">
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
      <p v-if="!session.accountAddress" class="muted" style="margin:8px 0 0;text-align:center;font-size:13px">
        Connect wallet to send messages.
      </p>
      <p v-else-if="!activeSecretJwk && !loading" class="muted" style="margin:8px 0 0;text-align:center;font-size:13px">
        Decrypt the bucket key to enable sending.
      </p>
      <p v-if="sendError" style="margin:8px 0 0;color:var(--status-error);text-align:center;font-size:13px">{{ sendError }}</p>
    </div>

    <div id="chat-bottom-anchor"></div>
  </div>
</template>

<style scoped>
.ib-page {
  display: flex; flex-direction: column; height: 100%; flex: 1;
  background: #f7f8fa; font-family: inherit;
}

.ib-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 18px; flex-shrink: 0; gap: 12px; flex-wrap: wrap;
}
.ib-header-left { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ib-source-badge {
  display: inline-flex; align-items: center; gap: 4px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #fff; font-size: 11px; font-weight: 700; letter-spacing: 0.05em;
  padding: 3px 10px; border-radius: 999px; width: fit-content;
  text-transform: uppercase;
}
.ib-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--text-primary); }
.ib-subtitle { font-size: 12px; color: var(--text-secondary); }
.ib-header-actions { display: flex; gap: 8px; flex-shrink: 0; }

.ib-error { margin: 8px 18px; color: var(--status-error); font-size: 14px; }

/* Panels */
.ib-panel {
  margin: 0 18px 8px; border: 1px solid var(--border-default);
  border-radius: 10px; background: var(--surface-card); overflow: hidden;
}
.ib-panel-summary {
  list-style: none; cursor: pointer; padding: 12px 16px;
  font-weight: 600; font-size: 14px; display: flex;
  justify-content: space-between; align-items: center;
  user-select: none; color: var(--text-primary);
}
.ib-panel-summary::-webkit-details-marker { display: none; }
.ib-panel-toggle { font-size: 16px; color: var(--text-secondary); transition: transform 200ms; }
.ib-panel[open] .ib-panel-toggle { transform: rotate(45deg); }
.ib-panel-body { padding: 0 16px 16px; }

.ib-meta { margin: 0; display: grid; gap: 6px; }
.ib-meta-row {
  display: grid; grid-template-columns: minmax(110px, 180px) 1fr;
  gap: 8px; font-size: 13px; align-items: baseline;
}
.ib-meta-row dt { color: var(--text-secondary); font-weight: 600; margin: 0; }
.ib-meta-row dd { color: var(--text-primary); margin: 0; word-break: break-all; }
.mono { font-family: monospace; font-size: 12px; }

.ib-section-label { margin: 0 0 6px; font-size: 13px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
.ib-member-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
.ib-member-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 10px; border: 1px solid var(--border-default);
  border-radius: 8px; background: rgba(255,255,255,0.7); font-size: 13px;
}
.ib-member-address { font-weight: 500; color: var(--text-primary); word-break: break-all; min-width: 0; }
.ib-member-block { color: var(--text-secondary); font-size: 12px; flex-shrink: 0; margin-left: 8px; }

/* Key status */
.ib-key-status {
  margin: 4px 18px 8px; padding: 8px 14px; border-radius: 8px; font-size: 13px;
  background: color-mix(in srgb, var(--status-warning) 8%, transparent);
  color: var(--status-warning); border: 1px solid color-mix(in srgb, var(--status-warning) 25%, transparent);
}
.ib-key-ok {
  background: color-mix(in srgb, var(--status-success) 8%, transparent);
  color: var(--status-success);
  border-color: color-mix(in srgb, var(--status-success) 25%, transparent);
}

/* Chat */
.ib-chat-viewport {
  flex: 1; padding: 16px 18px 24px; display: flex; flex-direction: column; gap: 14px;
}

/* Footer / Composer */
.ib-footer {
  position: sticky; bottom: 0; z-index: 50; padding: 12px 18px;
  background: rgba(247,248,250,0.95); backdrop-filter: blur(6px);
  border-top: 1px solid var(--border-default);
}
.ib-composer {
  display: flex; gap: 10px; align-items: flex-end;
}
.ib-composer-input {
  flex: 1; min-height: 44px; max-height: 120px; border-radius: 22px;
  padding: 10px 16px; background: #f0f2f5; resize: none;
}
.ib-composer-send {
  border-radius: 50%; width: 44px; height: 44px; padding: 0;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.ib-composer-attach {
  background: none; border: 1px solid var(--border-default); border-radius: 50%;
  width: 40px; height: 40px; font-size: 18px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  color: var(--text-secondary); transition: border-color 150ms, color 150ms;
}
.ib-composer-attach:hover:not(:disabled) { border-color: var(--color-primary); color: var(--color-primary); }
.ib-composer-attach:disabled { opacity: 0.4; cursor: not-allowed; }

/* Attachment chip (replaces textarea) */
.ib-attachment-chip {
  flex: 1; display: flex; align-items: center; gap: 10px;
  padding: 0 14px; min-height: 44px; border-radius: 22px;
  background: #f0f2f5; border: 1px solid var(--border-default);
  overflow: hidden;
}
.ib-attachment-chip-icon { flex-shrink: 0; color: var(--text-secondary); }
.ib-attachment-chip-name {
  flex: 1; font-size: 13px; font-weight: 500; color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}
.ib-attachment-chip-remove {
  background: none; border: none; font-size: 15px; cursor: pointer;
  color: var(--text-secondary); padding: 2px 4px; line-height: 1;
  border-radius: 50%; transition: color 150ms, background 150ms;
}
.ib-attachment-chip-remove:hover { color: var(--status-error); background: rgba(0,0,0,0.06); }

@media (max-width: 840px) {
  .ib-chat-viewport { padding: 12px 12px 24px; }
  .ib-meta-row { grid-template-columns: 1fr; gap: 2px; }
  .ib-header { padding: 12px; }
}
</style>
