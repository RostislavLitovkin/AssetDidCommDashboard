<script lang="ts">
export interface ChatMessageProps {
  id: string
  body: string
  outgoing: boolean
  senderLabel: string
  senderAddress?: string
  tag?: string
  contentType?: string
  attachment?: ChatMessageAttachment
  reference?: string
  payloadError?: string
  timestampLabel: string
  debugEntries?: { key: string; value: string }[]
}

/** Try to parse the body as a file-attachment envelope. */
export function parseAttachmentEnvelope(body: string): AttachmentEnvelope | null {
  try {
    const parsed = JSON.parse(body)
    if (parsed && typeof parsed === "object" && parsed.type === "attachment" && typeof parsed.data === "string") {
      return parsed as AttachmentEnvelope
    }
  } catch { /* not JSON */ }
  return null
}

export interface AttachmentEnvelope {
  type: "attachment"
  contentType: string
  fileName: string
  data: string // base64
}

export interface ChatMessageAttachment {
  contentType: string
  fileName?: string
  data: string // base64
}
</script>

<script setup lang="ts">
import { computed } from "vue"
import { Paperclip } from "lucide-vue-next"
import { useSettingsStore } from "../../stores/settings"

const props = defineProps<{
  message: ChatMessageProps
}>()

const settings = useSettingsStore()

function defaultFileName(contentType: string): string {
  const subtype = contentType.split("/")[1]?.split(";")[0]?.trim()
  return `attachment.${subtype || "bin"}`
}

const attachment = computed<AttachmentEnvelope | null>(() => {
  const explicit = props.message.attachment
  if (explicit) {
    return {
      type: "attachment",
      contentType: explicit.contentType,
      fileName: explicit.fileName || defaultFileName(explicit.contentType),
      data: explicit.data
    }
  }
  return parseAttachmentEnvelope(props.message.body)
})
const isImage = computed(() => attachment.value?.contentType?.startsWith("image/") ?? false)
const isVideo = computed(() => attachment.value?.contentType?.startsWith("video/") ?? false)
const isAudio = computed(() => attachment.value?.contentType?.startsWith("audio/") ?? false)
const dataUrl = computed(() => {
  const a = attachment.value
  if (!a) return ""
  return `data:${a.contentType};base64,${a.data}`
})

function downloadAttachment() {
  const a = attachment.value
  if (!a) return
  const link = document.createElement("a")
  link.href = dataUrl.value
  link.download = a.fileName
  link.click()
}

function formatFileSize(base64: string): string {
  const bytes = Math.ceil(base64.length * 3 / 4)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="chat-row" :class="message.outgoing ? 'chat-row-outgoing' : 'chat-row-incoming'">
    <div class="chat-message">
      <p v-if="!message.outgoing" class="chat-sender">{{ message.senderLabel }}</p>
      <article class="chat-bubble" :class="message.outgoing ? 'chat-bubble-outgoing' : 'chat-bubble-incoming'">

        <!-- Attachment rendering -->
        <template v-if="attachment">
          <!-- Image -->
          <div v-if="isImage" class="chat-attachment-media">
            <img :src="dataUrl" :alt="attachment.fileName" class="chat-attachment-img" loading="lazy" @click="downloadAttachment" />
          </div>
          <!-- Video -->
          <div v-else-if="isVideo" class="chat-attachment-media">
            <video :src="dataUrl" controls class="chat-attachment-video">
              Your browser does not support the video element.
            </video>
          </div>
          <!-- Audio -->
          <div v-else-if="isAudio" class="chat-attachment-audio">
            <audio :src="dataUrl" controls class="chat-attachment-audio-player">
              Your browser does not support the audio element.
            </audio>
          </div>
          <!-- Generic file -->
          <div v-else class="chat-attachment-file" @click="downloadAttachment">
            <Paperclip :size="22" class="chat-attachment-file-icon" />
            <div class="chat-attachment-file-info">
              <span class="chat-attachment-file-name" :title="attachment.fileName">{{ attachment.fileName }}</span>
              <span class="chat-attachment-file-meta">{{ attachment.contentType }} · {{ formatFileSize(attachment.data) }}</span>
            </div>
          </div>
          <!-- Filename + size caption for media (the generic-file card shows this itself) -->
          <p v-if="isImage || isVideo || isAudio" class="chat-attachment-caption">
            <span class="chat-attachment-caption-name">{{ attachment.fileName }}</span> · {{ formatFileSize(attachment.data) }}
          </p>
        </template>

        <!-- Plain text message -->
        <template v-else>
          <p class="chat-text">{{ message.body }}</p>
        </template>

        <p v-if="message.payloadError" class="chat-warning">⚠ {{ message.payloadError }}</p>
        <details v-if="settings.showMessageDebug && message.debugEntries?.length" class="chat-debug">
          <summary>Debug</summary>
          <dl class="chat-debug-grid">
            <div v-for="entry in message.debugEntries" :key="`${message.id}-${entry.key}`" class="chat-debug-item">
              <dt>{{ entry.key }}</dt>
              <dd>{{ entry.value }}</dd>
            </div>
          </dl>
        </details>
      </article>
      <p class="chat-timestamp">{{ message.timestampLabel }}</p>
    </div>
  </div>
</template>

<style scoped>
.chat-row { display: flex; width: 100%; }
.chat-row-incoming { justify-content: flex-start; }
.chat-row-outgoing { justify-content: flex-end; }

.chat-message {
  max-width: min(78%, 560px); display: flex; flex-direction: column;
  align-items: flex-start; gap: 6px;
}
.chat-row-outgoing .chat-message { align-items: flex-end; }

.chat-sender { margin: 0; font-size: 12px; font-weight: 600; color: var(--color-primary); }

.chat-bubble {
  width: 100%; border-radius: 14px; padding: 12px 14px;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.06);
}
.chat-bubble-incoming {
  background: color-mix(in srgb, var(--color-primary) 6%, var(--color-white));
  border: 1px solid color-mix(in srgb, var(--color-primary) 35%, var(--border-default));
  border-left: 3px solid var(--color-primary); padding-left: 12px;
}
.chat-bubble-outgoing {
  background: var(--color-primary);
  border: 1px solid color-mix(in srgb, var(--color-primary) 70%, #000);
}

.chat-bubble-outgoing .chat-text,
.chat-bubble-outgoing .chat-debug,
.chat-bubble-outgoing .chat-debug summary,
.chat-bubble-outgoing .chat-debug-item dt,
.chat-bubble-outgoing .chat-debug-item dd { color: rgba(255, 255, 255, 0.92); }
.chat-bubble-outgoing .chat-warning { color: rgba(255, 255, 255, 0.9); }
.chat-bubble-outgoing .chat-attachment-caption { color: rgba(255, 255, 255, 0.8); }
.chat-bubble-outgoing .chat-attachment-caption-name,
.chat-bubble-outgoing .chat-attachment-file-name,
.chat-bubble-outgoing .chat-attachment-file-meta { color: rgba(255, 255, 255, 0.92); }

.chat-text { margin: 0; white-space: pre-wrap; word-break: break-word; }
.chat-warning { margin: 8px 0 0; font-size: 12px; color: var(--status-error); }

/* Attachments — media spans the full width of the bubble by bleeding past its padding */
.chat-attachment-media {
  margin: 2px -14px 0;
  border-radius: 10px;
  overflow: hidden;
}
.chat-bubble-incoming .chat-attachment-media { margin-left: -12px; }

.chat-attachment-img {
  display: block; width: 100%; max-height: 420px;
  object-fit: cover; cursor: pointer;
}
.chat-attachment-img:hover { opacity: 0.92; }
.chat-attachment-video {
  display: block; width: 100%; max-height: 420px;
}
.chat-attachment-audio { margin: 6px 0 0; }
.chat-attachment-audio-player { width: 100%; }

.chat-attachment-file {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border: 1px solid var(--border-default); border-radius: 10px;
  background: rgba(255,255,255,0.12); cursor: pointer;
  transition: background 150ms ease;
  max-width: 100%;
}
.chat-attachment-file:hover { background: rgba(255,255,255,0.2); }
.chat-attachment-file-icon { flex-shrink: 0; color: var(--text-secondary); }
.chat-attachment-file-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.chat-attachment-file-name {
  font-size: 13px; font-weight: 600; color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.chat-attachment-file-meta { font-size: 11px; color: var(--text-secondary); }
.chat-attachment-caption {
  margin: 8px 0 0; font-size: 12px; color: var(--text-secondary);
  word-break: break-word;
}
.chat-attachment-caption-name { font-weight: 600; color: var(--text-primary); }

.chat-debug { margin-top: 10px; font-size: 12px; color: var(--text-secondary); }
.chat-debug summary { cursor: pointer; font-weight: 600; color: var(--text-primary); }
.chat-debug-grid { margin: 8px 0 0; display: grid; gap: 6px; }
.chat-debug-item {
  display: grid; grid-template-columns: minmax(100px, 160px) 1fr;
  gap: 8px; word-break: break-word;
}
.chat-debug-item dt { margin: 0; font-weight: 600; color: var(--text-secondary); }
.chat-debug-item dd { margin: 0; color: var(--text-primary); white-space: pre-wrap; }

.chat-timestamp { margin: 0; font-size: 11px; color: var(--text-secondary); }

@media (max-width: 840px) {
  .chat-message { max-width: 100%; }
  .chat-debug-item { grid-template-columns: 1fr; }
}
</style>
