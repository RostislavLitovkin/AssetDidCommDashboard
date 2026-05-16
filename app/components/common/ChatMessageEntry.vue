<script lang="ts">
export interface ChatMessageProps {
  id: string
  body: string
  outgoing: boolean
  senderLabel: string
  senderAddress?: string
  tag?: string
  contentType?: string
  reference?: string
  payloadError?: string
  timestampLabel: string
  debugEntries?: { key: string; value: string }[]
}
</script>

<script setup lang="ts">
import { useSettingsStore } from "../../stores/settings"

defineProps<{
  message: ChatMessageProps
}>()

const settings = useSettingsStore()
</script>

<template>
  <div class="chat-row" :class="message.outgoing ? 'chat-row-outgoing' : 'chat-row-incoming'">
    <div class="chat-message">
      <p v-if="!message.outgoing" class="chat-sender">{{ message.senderLabel }}</p>
      <article class="chat-bubble" :class="message.outgoing ? 'chat-bubble-outgoing' : 'chat-bubble-incoming'">
        <p class="chat-text">{{ message.body }}</p>
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

.chat-text { margin: 0; white-space: pre-wrap; word-break: break-word; }
.chat-warning { margin: 8px 0 0; font-size: 12px; color: var(--status-error); }

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
