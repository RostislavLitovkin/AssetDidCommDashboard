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
  avatarUrl?: string
  /** Optimistic message still in flight — timestampLabel carries its send status. */
  pending?: boolean
  /** Pending message whose send failed — shows Retry/Discard actions. */
  failed?: boolean
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
import { computed, ref } from "vue"
import { Paperclip, KeyRound } from "lucide-vue-next"
import { useSettingsStore } from "../../stores/settings"

const KEY_SHARING_TAG = "didcomm/key-sharing-v1"

const props = withDefaults(defineProps<{
  message: ChatMessageProps
  showAvatars?: boolean
}>(), {
  showAvatars: false
})

const emit = defineEmits<{ retry: []; discard: [] }>()

const settings = useSettingsStore()

// Key-sharing messages are protocol events, not conversation — rendered as a
// centered system notice with a separation line instead of a chat bubble.
const isKeySharing = computed(() => props.message.tag === KEY_SHARING_TAG)

// Per-instance: flip to the default avatar if the real picture URL fails to load.
const avatarFailed = ref(false)

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
  <!-- Key-sharing: centered system notice with a separation line, no avatar/bubble -->
  <div v-if="isKeySharing" class="chat-system-notice">
    <span class="chat-system-notice-text">
      <KeyRound :size="14" class="chat-system-notice-icon" aria-hidden="true" />
      {{ message.senderLabel }} has set a new Encryption key at {{ message.timestampLabel }}
    </span>
  </div>

  <div v-else class="chat-row" :class="[
    message.outgoing ? 'chat-row-outgoing' : 'chat-row-incoming',
    { 'chat-row-has-avatar': showAvatars && !message.outgoing }
  ]">
    <div v-if="showAvatars && !message.outgoing" class="chat-avatar-unit">
      <img v-if="!avatarFailed && message.avatarUrl" class="chat-avatar" :src="message.avatarUrl"
        :alt="message.senderLabel" @error="avatarFailed = true" />
      <img v-else class="chat-avatar" src="@/assets/Images/xcavateprofilepicture.png" alt="" />
      <span class="chat-avatar-arrow" aria-hidden="true"></span>
    </div>
    <div class="chat-message">
      <p v-if="!message.outgoing" class="chat-sender">{{ message.senderLabel }}</p>
      <article class="chat-bubble" :class="[
        message.outgoing ? 'chat-bubble-outgoing' : 'chat-bubble-incoming',
        { 'chat-bubble-pending': message.pending, 'chat-bubble-failed': message.failed }
      ]">

        <!-- Attachment rendering -->
        <template v-if="attachment">
          <!-- Image -->
          <div v-if="isImage" class="chat-attachment-media">
            <img :src="dataUrl" :alt="attachment.fileName" class="chat-attachment-img" loading="lazy"
              @click="downloadAttachment" />
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
              <span class="chat-attachment-file-meta">{{ attachment.contentType }} · {{ formatFileSize(attachment.data)
                }}</span>
            </div>
          </div>
          <!-- Filename + size caption for media (the generic-file card shows this itself) -->
          <p v-if="isImage || isVideo || isAudio" class="chat-attachment-caption">
            <span class="chat-attachment-caption-name">{{ attachment.fileName }}</span> · {{
              formatFileSize(attachment.data) }}
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
      <div v-if="message.failed" class="chat-timestamp-failed-row">
        <span class="chat-timestamp chat-timestamp-failed">{{ message.timestampLabel }}</span>
        <button type="button" class="chat-failed-action" @click="emit('retry')">Retry</button>
        <span class="chat-failed-sep" aria-hidden="true">·</span>
        <button type="button" class="chat-failed-action" @click="emit('discard')">Discard</button>
      </div>
      <p v-else class="chat-timestamp" :class="{ 'chat-timestamp-pending': message.pending }">{{ message.timestampLabel
        }}</p>
    </div>
  </div>
</template>

<style scoped>
/* Key-sharing system notice: centered text flanked by a separation line. */
.chat-system-notice {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin: 2px 0;
}

.chat-system-notice::before,
.chat-system-notice::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--border-default);
}

.chat-system-notice-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  max-width: 80%;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
}

.chat-system-notice-icon {
  flex-shrink: 0;
  color: var(--color-primary);
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

/* Bottom-align so the avatar rides the bubble as the message scrolls. */
.chat-row-has-avatar {
  align-items: flex-end;
}

.chat-row-has-avatar .chat-message {
  max-width: min(78%, 520px);
}

/* Avatar + arrow travel with the message (sticky) and stay visible while it's on
   screen. The vertical margins fence their travel area to the bubble alone: they
   inset the sticky range past the sender label above and the timestamp below —
   each a 16px line + the 6px column gap = 22px — so the pair rides the bubble's
   edge instead of drifting up to the nickname or down to the timestamp. Keep in
   sync with the .chat-sender / .chat-timestamp line-heights and .chat-message gap. */
.chat-avatar-unit {
  position: sticky;
  top: 8px;
  bottom: 8px;
  align-self: flex-end;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 22px;
  margin-bottom: 22px;
  /* No trailing gap: the arrow's base sits flush against the bubble's edge. */
  margin-right: 0;
}

.chat-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
  flex-shrink: 0;
  background: var(--surface-bg);
}

/* Primary-colored tail: base overlaps the bubble edge by 1px so it stays
   seamlessly joined to the bubble (and its primary border-left) at any
   scroll position, with the point aimed at the sticky avatar. */
.chat-avatar-arrow {
  width: 0;
  height: 0;
  flex-shrink: 0;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  border-right: 7px solid var(--color-primary);
  margin-right: -1px;
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

/* Sender labels can be full SS58 addresses — one unbreakable word. `anywhere`
   (unlike break-word) also shrinks the flex min-content size, so the label can
   never widen the chat column past its max-width on narrow screens. */
.chat-sender {
  margin: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  color: var(--color-primary);
}

.chat-bubble {
  width: 100%;
  border-radius: 14px;
  padding: 12px 14px;
}

.chat-bubble-incoming {
  background: color-mix(in srgb, var(--color-primary) 6%, var(--color-white));
  border-left: 3px solid var(--color-primary);
  padding-left: 12px;
  min-height: 44px;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.06);
}

.chat-bubble-outgoing {
  background: var(--color-primary);
  min-height: 44px;
}

.chat-bubble-outgoing .chat-text,
.chat-bubble-outgoing .chat-debug,
.chat-bubble-outgoing .chat-debug summary,
.chat-bubble-outgoing .chat-debug-item dt,
.chat-bubble-outgoing .chat-debug-item dd {
  color: rgba(255, 255, 255, 0.92);
}

.chat-bubble-outgoing .chat-warning {
  color: rgba(255, 255, 255, 0.9);
}

.chat-bubble-outgoing .chat-attachment-caption {
  color: rgba(255, 255, 255, 0.8);
}

.chat-bubble-outgoing .chat-attachment-caption-name,
.chat-bubble-outgoing .chat-attachment-file-name,
.chat-bubble-outgoing .chat-attachment-file-meta {
  color: rgba(255, 255, 255, 0.92);
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

/* Attachments — media spans the full width of the bubble by bleeding past its padding */
.chat-attachment-media {
  margin: 2px -14px 0;
  border-radius: 10px;
  overflow: hidden;
}

.chat-bubble-incoming .chat-attachment-media {
  margin-left: -12px;
}

.chat-attachment-img {
  display: block;
  width: 100%;
  max-height: 420px;
  object-fit: cover;
  cursor: pointer;
}

.chat-attachment-img:hover {
  opacity: 0.92;
}

.chat-attachment-video {
  display: block;
  width: 100%;
  max-height: 420px;
}

.chat-attachment-audio {
  margin: 6px 0 0;
}

.chat-attachment-audio-player {
  width: 100%;
}

.chat-attachment-file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  cursor: pointer;
  transition: background 150ms ease;
  max-width: 100%;
}

.chat-attachment-file:hover {
  background: rgba(255, 255, 255, 0.2);
}

.chat-attachment-file-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.chat-attachment-file-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.chat-attachment-file-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-attachment-file-meta {
  font-size: 11px;
  color: var(--text-secondary);
}

.chat-attachment-caption {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-word;
}

.chat-attachment-caption-name {
  font-weight: 500;
  color: var(--text-primary);
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
  grid-template-columns: minmax(100px, 160px) 1fr;
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
  line-height: 16px;
  color: var(--text-secondary);
}

.chat-bubble-pending {
  opacity: 0.85;
}

.chat-timestamp-pending {
  font-style: italic;
  animation: chat-pending-pulse 1.4s ease-in-out infinite;
}

@keyframes chat-pending-pulse {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.45;
  }
}

.chat-bubble-failed {
  opacity: 1;
  border-color: var(--status-error);
  box-shadow: 0 3px 8px color-mix(in srgb, var(--status-error) 18%, transparent);
}

.chat-timestamp-failed-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chat-timestamp-failed {
  color: var(--status-error);
  font-weight: 600;
}

.chat-failed-sep {
  font-size: 11px;
  line-height: 16px;
  color: var(--text-secondary);
}

.chat-failed-action {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  color: var(--color-primary);
  text-decoration: underline;
}

.chat-failed-action:hover {
  opacity: 0.75;
}

@media (max-width: 840px) {
  .chat-message {
    max-width: 100%;
  }

  .chat-row-has-avatar .chat-message {
    max-width: calc(100% - 56px);
  }

  .chat-debug-item {
    grid-template-columns: 1fr;
  }
}
</style>
