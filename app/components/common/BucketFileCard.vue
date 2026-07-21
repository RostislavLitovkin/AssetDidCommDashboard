<script setup lang="ts">
import { computed } from "vue"
import { Download, Lock, Film, Music, FileText, AlertTriangle } from "lucide-vue-next"
import type { ChatMessageAttachment } from "./ChatMessageEntry.vue"

const props = defineProps<{
  // Decrypted file, once available. Absent while the file is locked/undecryptable.
  attachment?: ChatMessageAttachment
  // On-chain MIME type — always known, even before decryption.
  contentType: string
  senderLabel: string
  timestampLabel: string
  // IPFS reference/CID, shown in the locked state so the file is still identifiable.
  cid?: string
  // Payload-fetch or decrypt error, if any.
  error?: string
  // True when the user has no key loaded to decrypt this bucket's files.
  locked?: boolean
}>()

const effectiveContentType = computed(() => props.attachment?.contentType ?? props.contentType)
const isImage = computed(() => effectiveContentType.value.startsWith("image/"))
const isVideo = computed(() => effectiveContentType.value.startsWith("video/"))
const isAudio = computed(() => effectiveContentType.value.startsWith("audio/"))

function defaultFileName(contentType: string): string {
  const subtype = contentType.split("/")[1]?.split(";")[0]?.trim()
  return `attachment.${subtype || "bin"}`
}

const displayName = computed(() =>
  props.attachment?.fileName || defaultFileName(effectiveContentType.value)
)

const dataUrl = computed(() => {
  const a = props.attachment
  return a ? `data:${a.contentType};base64,${a.data}` : ""
})

function formatFileSize(base64: string): string {
  const bytes = Math.ceil((base64.length * 3) / 4)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const metaLabel = computed(() => {
  const parts = [effectiveContentType.value]
  if (props.attachment) parts.push(formatFileSize(props.attachment.data))
  return parts.join(" · ")
})

const shortCid = computed(() => {
  const ref = props.cid?.trim()
  if (!ref) return ""
  return ref.length > 22 ? `${ref.slice(0, 12)}…${ref.slice(-6)}` : ref
})

function download() {
  const a = props.attachment
  if (!a) return
  const link = document.createElement("a")
  link.href = dataUrl.value
  link.download = displayName.value
  link.click()
}
</script>

<template>
  <article class="file-card" :class="{ 'file-card-muted': !attachment }">
    <!-- Thumbnail / icon -->
    <button
      v-if="attachment"
      type="button"
      class="file-thumb file-thumb-clickable"
      :title="`Download ${displayName}`"
      @click="download"
    >
      <img v-if="isImage" :src="dataUrl" :alt="displayName" class="file-thumb-img" loading="lazy" />
      <Film v-else-if="isVideo" :size="22" class="file-thumb-icon" />
      <Music v-else-if="isAudio" :size="22" class="file-thumb-icon" />
      <FileText v-else :size="22" class="file-thumb-icon" />
    </button>
    <div v-else class="file-thumb file-thumb-static">
      <AlertTriangle v-if="error" :size="20" class="file-thumb-icon file-thumb-icon-error" />
      <Lock v-else-if="locked" :size="20" class="file-thumb-icon" />
      <span v-else class="file-thumb-spinner" aria-label="Decrypting" />
    </div>

    <!-- Info -->
    <div class="file-info">
      <span class="file-name" :title="attachment ? displayName : effectiveContentType">
        {{ attachment ? displayName : `Encrypted ${effectiveContentType}` }}
      </span>
      <span class="file-meta">{{ metaLabel }}</span>
      <span class="file-sub">
        {{ senderLabel }} · {{ timestampLabel }}
      </span>
      <span v-if="error" class="file-status file-status-error">⚠ {{ error }}</span>
      <span v-else-if="!attachment && locked" class="file-status">🔒 Load your X25519 key to view this file</span>
    </div>

    <!-- Action -->
    <button v-if="attachment" type="button" class="file-download" title="Download" @click="download">
      <Download :size="16" />
    </button>
  </article>
</template>

<style scoped>
.file-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  background: var(--color-white);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
  min-width: 0;
}
.file-card-muted {
  background: #f6f7f9;
}

.file-thumb {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-white));
  border: 1px solid var(--border-default);
  padding: 0;
}
.file-thumb-clickable {
  cursor: pointer;
  transition: opacity 150ms ease;
}
.file-thumb-clickable:hover {
  opacity: 0.85;
}
.file-thumb-static {
  background: #eceef1;
}
.file-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.file-thumb-icon {
  color: var(--color-primary);
}
.file-thumb-icon-error {
  color: var(--status-error);
}
.file-thumb-spinner {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--color-primary) 25%, transparent);
  border-top-color: var(--color-primary);
  animation: file-thumb-spin 0.7s linear infinite;
}
@keyframes file-thumb-spin {
  to { transform: rotate(360deg); }
}

.file-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.file-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-meta {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-sub {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-status {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary);
}
.file-status-error {
  color: var(--status-error);
}

.file-download {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--border-default);
  background: var(--color-white);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 150ms ease, color 150ms ease;
}
.file-download:hover {
  background: var(--color-primary);
  color: var(--color-white);
  border-color: var(--color-primary);
}

@media (max-width: 640px) {
  .file-sub {
    white-space: normal;
  }
}
</style>
