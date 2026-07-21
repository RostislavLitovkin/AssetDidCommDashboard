<script setup lang="ts">
import {
  fetchFileMessagesPage,
  fetchIndexedMessagesByTag,
  isFileMessage,
  type IndexedMessage
} from "../../../../services/indexer/subqueryClient"
import BucketFileCard from "../../../../components/common/BucketFileCard.vue"
import type { ChatMessageAttachment } from "../../../../components/common/ChatMessageEntry.vue"
import LoadingBar from "../../../../components/common/LoadingBar.vue"
import { Paperclip, ArrowLeft } from "lucide-vue-next"
import * as jose from "jose"
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRuntimeConfig } from "nuxt/app"
import { useSessionStore } from "../../../../stores/session"
import { useSettingsStore } from "../../../../stores/settings"
import { useAddress } from "../../../../composables/useAddress"

const PAGE_SIZE = 20
const keySharingTag = "didcomm/key-sharing-v1"

const route = useRoute()
const config = useRuntimeConfig()
const session = useSessionStore()
const settings = useSettingsStore()
const { formatAddress, addressesEqual } = useAddress()

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
const files = ref<IndexedMessage[]>([])
const cursor = ref<string | null>(null)
const hasNextPage = ref(true)
const loadingPage = ref(false)
const initialLoading = ref(true)
const error = ref("")
const keyMissing = ref(false)

const payloadById = ref<Record<string, string>>({})
const payloadErrorById = ref<Record<string, string>>({})
const attachmentById = ref<Record<string, ChatMessageAttachment>>({})
const decryptErrorById = ref<Record<string, string>>({})
const activeSecretJwk = ref<jose.JWK | null>(null)

const viewport = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

// ── Crypto helpers ─────────────────────────────────────────────────
function isX25519Secret(v: unknown): v is jose.JWK {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false
  const c = v as Record<string, unknown>
  return c.kty === "OKP" && c.crv === "X25519" && typeof c.x === "string" && typeof c.d === "string"
}

function looksLikeCompactJwe(s: string): boolean {
  const p = s.split(".")
  return p.length === 5 && p.every(x => x.length > 0)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function resolveUrl(ref: string): string {
  const t = ref.trim()
  if (/^https?:\/\//i.test(t)) return t
  return `${pinataGateway.value}/ipfs/${t}`
}

// ── IPFS payload hydration ─────────────────────────────────────────
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

// ── Bucket key recovery (from key-sharing messages) ────────────────
async function decryptKeySharing(keySharingMessages: IndexedMessage[]) {
  const secretJwk = settings.x25519SecretJwk
  if (!secretJwk) return

  // Try from latest to earliest to find the most recent working key.
  const reversed = [...keySharingMessages].reverse()
  for (const ksMsg of reversed) {
    const raw = payloadById.value[ksMsg.id]
    if (!raw?.trim()) continue
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue
      const key = await jose.importJWK(secretJwk as jose.JWK, "ECDH-ES+A256KW")
      const { plaintext } = await jose.generalDecrypt(parsed as jose.GeneralJWE, key)
      const inner = JSON.parse(new TextDecoder().decode(plaintext))
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        const keys = Array.isArray(inner.keys) ? inner.keys : []
        for (const k of keys) {
          if (isX25519Secret(k)) {
            activeSecretJwk.value = { ...k, use: "enc" }
            break
          }
        }
      }
      if (activeSecretJwk.value) return // found a working key
    } catch {
      // This key-sharing message didn't decrypt; try the next one.
    }
  }
}

// The bucket's decryption secret lives in its key-sharing messages, which the
// file-only query deliberately excludes — so we fetch them separately here.
async function loadKeySharing() {
  const url = indexerUrl.value
  if (!url) return
  keyMissing.value = !settings.x25519SecretJwk
  try {
    const keySharingMessages = await fetchIndexedMessagesByTag(url, bucketId.value, keySharingTag)
    await hydratePayloads(keySharingMessages)
    await decryptKeySharing(keySharingMessages)
  } catch {
    // A failed key-sharing load just leaves files locked; the list still renders.
  }
}

// ── File attachment decryption ─────────────────────────────────────
async function hydrateAttachments(msgs: IndexedMessage[]) {
  const sk = activeSecretJwk.value
  if (!sk || !isX25519Secret(sk)) return // locked: no bucket key yet

  const next: Record<string, ChatMessageAttachment> = { ...attachmentById.value }
  const nextE: Record<string, string> = { ...decryptErrorById.value }

  await Promise.all(msgs.map(async m => {
    if (next[m.id]) return
    const fileJwe = payloadById.value[m.id]?.trim()
    if (!fileJwe) {
      // No payload to decrypt: surface it rather than spinning forever.
      if (!payloadErrorById.value[m.id]) nextE[m.id] = "File payload unavailable"
      return
    }
    try {
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

// ── Infinite scroll paging ─────────────────────────────────────────
async function loadNextPage() {
  if (loadingPage.value || !hasNextPage.value) return
  loadingPage.value = true
  error.value = ""
  try {
    const url = indexerUrl.value
    if (!url) throw new Error("SubQuery indexer URL is not configured")

    const page = await fetchFileMessagesPage(url, bucketId.value, { first: PAGE_SIZE, after: cursor.value })
    const pageFiles = page.nodes.filter(isFileMessage)

    // Show the cards immediately; their previews fill in as decryption resolves,
    // so the page never blocks on IPFS fetches + decryption before rendering.
    files.value.push(...pageFiles)
    cursor.value = page.endCursor
    hasNextPage.value = page.hasNextPage && Boolean(page.endCursor)
    void hydratePageContent(pageFiles)
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load files"
  } finally {
    loadingPage.value = false
    initialLoading.value = false
  }
}

// Fetch and decrypt a page's file payloads in the background, after the cards are
// already on screen. Thumbnails and filenames appear as each page resolves.
async function hydratePageContent(pageFiles: IndexedMessage[]) {
  await hydratePayloads(pageFiles)
  await hydrateAttachments(pageFiles)
}

function sentinelNearViewport(): boolean {
  const s = sentinel.value
  const v = viewport.value
  if (!s || !v) return false
  const sr = s.getBoundingClientRect()
  const vr = v.getBoundingClientRect()
  return sr.top <= vr.bottom + 300
}

async function maybeLoadMore() {
  if (loadingPage.value || !hasNextPage.value || error.value) return
  await loadNextPage()
  // Keep pulling while the sentinel is still on screen (tall viewport / short page),
  // until it scrolls out of view or the pages run out.
  await nextTick()
  if (!error.value && hasNextPage.value && sentinelNearViewport()) {
    await maybeLoadMore()
  }
}

function setupObserver() {
  if (!sentinel.value) return
  observer = new IntersectionObserver(
    entries => { if (entries.some(e => e.isIntersecting)) void maybeLoadMore() },
    { root: viewport.value, rootMargin: "300px" }
  )
  observer.observe(sentinel.value)
}

function retry() {
  error.value = ""
  void maybeLoadMore()
}

// ── View model ─────────────────────────────────────────────────────
interface FileCardVm {
  id: string
  attachment?: ChatMessageAttachment
  contentType: string
  senderLabel: string
  timestampLabel: string
  cid?: string
  error?: string
}

// Whether we hold the bucket secret needed to decrypt files. False both when the
// user has no personal key loaded and when no bucket key was shared with their key.
const canDecrypt = computed(() => Boolean(activeSecretJwk.value))

const fileCards = computed<FileCardVm[]>(() =>
  files.value.map(m => {
    const outgoing = Boolean(session.accountAddress && addressesEqual(m.contributor, session.accountAddress))
    return {
      id: m.id,
      attachment: attachmentById.value[m.id],
      contentType: m.contentType?.trim() || "application/octet-stream",
      senderLabel: outgoing ? "You" : formatAddress(m.contributor ?? ""),
      timestampLabel: `Block #${m.createdBlock}`,
      cid: m.reference ?? undefined,
      error: payloadErrorById.value[m.id] ?? decryptErrorById.value[m.id]
    }
  })
)

// ── Lifecycle ──────────────────────────────────────────────────────
watch(() => settings.x25519SecretJwk, async () => {
  // A new personal key can unlock (or re-key) every file already on screen.
  keyMissing.value = !settings.x25519SecretJwk
  activeSecretJwk.value = null
  attachmentById.value = {}
  decryptErrorById.value = {}
  await loadKeySharing()
  await hydrateAttachments(files.value)
}, { deep: true })

onMounted(async () => {
  settings.initialize()
  await loadKeySharing()
  await loadNextPage()
  await nextTick()
  setupObserver()
  // If the first page didn't fill the viewport, keep loading.
  if (sentinelNearViewport()) void maybeLoadMore()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div class="files-page ib-custom-page">
    <!-- Header -->
    <header class="buckets-header ib-header-row">
      <div class="ib-container ib-header-inner">
        <div class="row ib-header-left">
          <div class="stack" style="gap: 2px">
            <h3 class="ib-title">Bucket Files</h3>
          </div>
        </div>
      </div>
    </header>

    <div v-if="!initialLoading && (keyMissing || (!canDecrypt && fileCards.length))" class="ib-container">
      <p class="files-key-banner">
        <template v-if="keyMissing">
          🔒 Load your X25519 secret key in Settings to preview and download these files.
        </template>
        <template v-else>
          🔒 No bucket key has been shared with your key yet, so these files can't be decrypted.
        </template>
      </p>
    </div>

    <!-- Files viewport -->
    <div ref="viewport" class="files-viewport" role="list" aria-label="Bucket files">
      <div class="ib-container files-grid">
        <!-- Initial load: a single centered indicator, no double bars -->
        <div v-if="initialLoading" class="files-loading">
          <LoadingBar label="Loading files..." />
        </div>

        <template v-else>
          <BucketFileCard
            v-for="card in fileCards"
            :key="card.id"
            role="listitem"
            :attachment="card.attachment"
            :content-type="card.contentType"
            :sender-label="card.senderLabel"
            :timestamp-label="card.timestampLabel"
            :cid="card.cid"
            :error="card.error"
            :locked="!canDecrypt && !card.attachment"
          />

          <!-- Empty state -->
          <div v-if="!fileCards.length && !error" class="files-empty muted">
            <Paperclip :size="48" class="files-empty-icon" />
            <p style="margin: 0;">No files found for this bucket in the indexer.</p>
          </div>

          <!-- First-load error (no cards to show) -->
          <div v-if="error && !fileCards.length" class="files-page-error" style="justify-content:center; padding: 40px 0;">
            <span>{{ error }}</span>
            <button type="button" class="btn" @click="retry">Retry</button>
          </div>
        </template>

        <!-- Infinite-scroll sentinel + paging feedback -->
        <div ref="sentinel" class="files-sentinel">
          <LoadingBar v-if="loadingPage && !initialLoading" label="Loading more files..." />
          <div v-else-if="error && fileCards.length" class="files-page-error">
            <span>{{ error }}</span>
            <button type="button" class="btn" @click="retry">Retry</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.files-key-banner {
  margin: 12px 0 0;
  padding: 10px 14px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-white));
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, var(--border-default));
  font-size: 13px;
  color: var(--text-secondary);
}

/* Scrollable area */
.files-viewport {
  flex: 1;
  overflow-y: auto;
  background: transparent;
  overscroll-behavior: contain;
  min-height: 0;
  -webkit-overflow-scrolling: touch;
}

.files-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 24px;
  padding-bottom: 24px;
}

.files-loading {
  padding: 40px 0;
}

.files-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  padding: 56px 0;
}
.files-empty-icon {
  opacity: 0.3;
}

.files-sentinel {
  min-height: 8px;
  display: flex;
  justify-content: center;
}
.files-page-error {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--status-error);
  font-size: 13px;
}

@media (max-width: 960px) {
  .ib-container {
    padding: 0 16px;
  }
}

@media (max-width: 840px) {
  .files-grid {
    padding-top: 16px;
    padding-bottom: 16px;
  }
}
</style>
